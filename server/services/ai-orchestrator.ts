import { Type } from '@google/genai';
import { EventEmitter } from 'node:events';
import {
  getDb,
  mutateDb,
  applyWalletCredit,
  getOrCreateWallet,
  logSystemError,
} from '../db/store.ts';
import { generateId } from '../lib/crypto.ts';
import {
  isProviderGenuinelyAvailable,
  resolveModelForTask,
  executeEngineCompletion,
} from '../engine/router.ts';
import type {
  AiModelRecord,
  AiProviderRecord,
  OrchestrationJobRecord,
  TaskType,
  OnboardingProfile,
} from '../types.ts';

export { isProviderGenuinelyAvailable, resolveModelForTask };

export const jobEventsEmitter = new EventEmitter();
jobEventsEmitter.setMaxListeners(100);

const activeJobControllers = new Map<string, AbortController>();

export interface ModelCallResult {
  text: string;
  modelUsed: string;
  providerName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export async function invokeModelAdapter(params: {
  model: AiModelRecord;
  provider: AiProviderRecord;
  systemInstruction: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<ModelCallResult> {
  return executeEngineCompletion(params);
}

export function calculateCreditCost(model: AiModelRecord, promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1000) * model.inputCreditsPer1k;
  const outputCost = (completionTokens / 1000) * model.outputCreditsPer1k;
  return Math.max(1, Math.ceil(inputCost + outputCost));
}

function appendJobEvent(
  jobId: string,
  type: OrchestrationJobRecord['events'][number]['type'],
  message: string,
  meta?: Record<string, unknown>
): void {
  const event = {
    id: generateId('evt'),
    timestamp: new Date().toISOString(),
    type,
    message,
    meta,
  };
  mutateDb((db) => {
    const job = db.orchestrationJobs.find((j) => j.id === jobId);
    if (job) {
      job.events.push(event);
      job.updatedAt = new Date().toISOString();
    }
  });
  jobEventsEmitter.emit(`job:${jobId}`, { event, job: getDb().orchestrationJobs.find((j) => j.id === jobId) });
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs') return 'javascript';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    }
    const startIdx = trimmed.indexOf('{');
    const endIdx = trimmed.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      return JSON.parse(trimmed.slice(startIdx, endIdx + 1)) as Record<string, unknown>;
    }
    throw new Error('Model response was not valid JSON');
  }
}

export function stopOrchestrationJob(jobId: string, userId: string): OrchestrationJobRecord | null {
  const controller = activeJobControllers.get(jobId);
  if (controller) {
    controller.abort();
    activeJobControllers.delete(jobId);
  }
  const updated = mutateDb((db) => {
    const job = db.orchestrationJobs.find((j) => j.id === jobId && j.userId === userId);
    if (!job) return null;
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'stopped';
      job.updatedAt = new Date().toISOString();
      const project = db.projects.find((p) => p.id === job.projectId);
      if (project) {
        project.status = 'ready';
        project.updatedAt = new Date().toISOString();
      }
    }
    return job;
  });
  if (updated) {
    appendJobEvent(jobId, 'job_stopped', 'Execution stopped by user. Checkpoint preserved.');
  }
  return updated;
}

export function startOrResumeOrchestrationJob(jobId: string): void {
  setImmediate(() => {
    void executeOrchestrationPipeline(jobId);
  });
}

async function executeOrchestrationPipeline(jobId: string): Promise<void> {
  const dbSnapshot = getDb();
  const job = dbSnapshot.orchestrationJobs.find((j) => j.id === jobId);
  if (!job) return;

  const controller = new AbortController();
  activeJobControllers.set(jobId, controller);

  mutateDb((db) => {
    const j = db.orchestrationJobs.find((x) => x.id === jobId);
    if (j) {
      j.status = 'running';
      j.errorMessage = null;
      j.updatedAt = new Date().toISOString();
    }
    const p = db.projects.find((x) => x.id === job.projectId);
    if (p) {
      p.status = 'building';
      p.updatedAt = new Date().toISOString();
    }
  });

  const onboarding: OnboardingProfile | undefined = dbSnapshot.onboardingProfiles.find(
    (o) => o.userId === job.userId
  );

  const onboardingContext = onboarding
    ? `User Context — Preferred Theme: ${onboarding.preferredTheme}; Project Purpose: ${onboarding.projectPurpose}; Project Scale: ${onboarding.projectScale}.`
    : 'User Context — Preferred Theme: light; Project Purpose: Business; Project Scale: Medium.';

  try {
    appendJobEvent(jobId, 'job_started', 'VEKTOR AI Senior Orchestrator initialized.');

    const existingFiles = getDb().projectFiles
      .filter((f) => f.projectId === job.projectId)
      .map((f) => ({ path: f.path, content: f.content }));

    const steps: Array<{ key: string; title: string; taskType: TaskType }> = [
      { key: 'plan', title: 'Decompose Architecture & Task Plan', taskType: 'orchestration' },
      { key: 'build', title: 'Generate Multi-File Application Code', taskType: 'coding' },
      { key: 'review', title: 'Verify Quality, Accessibility & Bundle', taskType: 'testing_debug' },
    ];

    if (job.tasks.length === 0) {
      mutateDb((db) => {
        const j = db.orchestrationJobs.find((x) => x.id === jobId);
        if (!j) return;
        j.tasks = steps.map((s) => {
          const resolved = resolveModelForTask(s.taskType, j.requestedModelId);
          return {
            stepKey: s.key,
            title: s.title,
            taskType: s.taskType,
            assignedModelId: resolved?.model.id || 'unconfigured',
            actualModelUsed: null,
            status: 'pending',
            latencyMs: 0,
            tokensUsed: 0,
            outputSummary: null,
          };
        });
      });
    }

    let architecturePlanText = '';

    for (let idx = getDb().orchestrationJobs.find((j) => j.id === jobId)!.currentStepIndex; idx < steps.length; idx++) {
      if (controller.signal.aborted) {
        return;
      }

      const step = steps[idx];

      // Check wallet balance before each step
      const wallet = getOrCreateWallet(job.userId);
      if (wallet.balanceCredits < 5) {
        mutateDb((db) => {
          const j = db.orchestrationJobs.find((x) => x.id === jobId);
          if (j) {
            j.status = 'paused_insufficient_credits';
            j.currentStepIndex = idx;
            j.updatedAt = new Date().toISOString();
          }
          const p = db.projects.find((x) => x.id === job.projectId);
          if (p) {
            p.status = 'paused_credits';
            p.updatedAt = new Date().toISOString();
          }
        });
        appendJobEvent(
          jobId,
          'job_paused',
          `Credits exhausted (${wallet.balanceCredits} remaining). Checkpoint saved at step "${step.title}". Top up to resume.`
        );
        return;
      }

      if (wallet.balanceCredits <= wallet.lowCreditThreshold) {
        appendJobEvent(
          jobId,
          'low_credit_warning',
          `Low credit balance: ${wallet.balanceCredits} credits remaining.`
        );
      }

      const resolved = resolveModelForTask(step.taskType, job.requestedModelId);
      if (!resolved) {
        throw new Error(
          `No available AI provider for task "${step.taskType}". Configure GEMINI_API_KEY or another provider in Admin > Model Providers.`
        );
      }

      mutateDb((db) => {
        const j = db.orchestrationJobs.find((x) => x.id === jobId);
        if (j && j.tasks[idx]) {
          j.tasks[idx].status = 'running';
          j.tasks[idx].assignedModelId = resolved.model.id;
          j.currentStepIndex = idx;
        }
      });

      appendJobEvent(
        jobId,
        'task_delegated',
        `Delegated "${step.title}" to ${resolved.model.displayName}${resolved.usedFallback ? ' (configured fallback)' : ''}`,
        { taskType: step.taskType, modelId: resolved.model.id }
      );

      let callResult: ModelCallResult;

      if (step.key === 'plan') {
        const planPrompt = [
          `User Request: ${job.prompt}`,
          onboardingContext,
          existingFiles.length > 0
            ? `Existing project files (${existingFiles.length}): ${existingFiles.map((f) => f.path).join(', ')}`
            : 'This is a brand new project.',
          'Analyze the request as VEKTOR AI Senior Orchestrator. Output a concise technical architecture plan (components, state, styling, interactive workflows, and file structure) in JSON.',
        ].join('\n\n');

        callResult = await invokeModelAdapter({
          model: resolved.model,
          provider: resolved.provider,
          systemInstruction:
            'You are VEKTOR AI, the central senior software architect. Return clean JSON with keys: projectTitle (short 2-4 words), summary (1-2 sentences), architectureNotes (string), plannedFiles (array of strings).',
          prompt: planPrompt,
          jsonSchema: {
            type: Type.OBJECT,
            properties: {
              projectTitle: { type: Type.STRING },
              summary: { type: Type.STRING },
              architectureNotes: { type: Type.STRING },
              plannedFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
          signal: controller.signal,
        });

        const parsedPlan = extractJsonObject(callResult.text);
        architecturePlanText = JSON.stringify(parsedPlan, null, 2);

        if (typeof parsedPlan.projectTitle === 'string' && parsedPlan.projectTitle.trim()) {
          mutateDb((db) => {
            const p = db.projects.find((x) => x.id === job.projectId);
            if (p && (p.name === 'Untitled Project' || p.name.length < 4)) {
              p.name = String(parsedPlan.projectTitle).slice(0, 60);
            }
          });
        }
      } else if (step.key === 'build') {
        const existingContext =
          existingFiles.length > 0
            ? existingFiles
                .slice(0, 6)
                .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 3500)}`)
                .join('\n\n')
            : 'No existing files yet.';

        const buildPrompt = [
          `User Request: ${job.prompt}`,
          onboardingContext,
          `Architecture Plan:\n${architecturePlanText}`,
          `Existing Files:\n${existingContext}`,
          `Generate a complete, polished, self-contained, immediately runnable web application.`,
          `CRITICAL: index.html MUST work standalone inside an iframe preview AND when published to /hosted/:slug! So include Tailwind via CDN (<script src="https://cdn.tailwindcss.com"></script>) or clean embedded CSS, plus complete interactive vanilla JS or inline script in index.html, AND also output modular source files (styles.css, app.js, README.md) so the user can inspect and edit them in the Code & Files tabs.`,
          `Respect the user's preferred theme (${onboarding?.preferredTheme || 'light'}) in the generated UI, use crisp typography, realistic domain data, working interactive buttons/forms/tabs, and zero placeholder stubs.`,
        ].join('\n\n');

        callResult = await invokeModelAdapter({
          model: resolved.model,
          provider: resolved.provider,
          systemInstruction:
            'You are the VEKTOR Coding Model. Output valid JSON with keys: assistantReply (concise summary of what was built), files (array of { path: string, content: string }). Ensure index.html is always included and is 100% runnable standalone in a browser iframe.',
          prompt: buildPrompt,
          jsonSchema: {
            type: Type.OBJECT,
            properties: {
              assistantReply: { type: Type.STRING },
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                },
              },
            },
          },
          signal: controller.signal,
        });

        const parsedBuild = extractJsonObject(callResult.text);
        const generatedFiles = Array.isArray(parsedBuild.files)
          ? (parsedBuild.files as Array<{ path?: unknown; content?: unknown }>)
          : [];

        if (generatedFiles.length === 0) {
          throw new Error('Model returned no files for the application.');
        }

        const now = new Date().toISOString();
        mutateDb((db) => {
          for (const item of generatedFiles) {
            if (typeof item.path !== 'string' || typeof item.content !== 'string') continue;
            const cleanPath = item.path.replace(/^\/+/, '');
            const existing = db.projectFiles.find(
              (f) => f.projectId === job.projectId && f.path === cleanPath
            );
            if (existing) {
              existing.content = item.content;
              existing.language = inferLanguage(cleanPath);
              existing.updatedAt = now;
            } else {
              db.projectFiles.push({
                id: generateId('file'),
                projectId: job.projectId,
                path: cleanPath,
                content: item.content,
                language: inferLanguage(cleanPath),
                updatedAt: now,
              });
            }
          }

          // Save immutable version snapshot for Undo & Version History
          const currentFiles = db.projectFiles
            .filter((f) => f.projectId === job.projectId)
            .map((f) => ({ path: f.path, content: f.content, language: f.language }));
          const prevVersions = db.projectVersions.filter((v) => v.projectId === job.projectId);
          const nextNum = prevVersions.length + 1;
          const versionId = generateId('ver');
          db.projectVersions.push({
            id: versionId,
            projectId: job.projectId,
            versionNumber: nextNum,
            summary: job.prompt.slice(0, 120),
            filesSnapshot: currentFiles,
            createdAt: now,
          });
          const proj = db.projects.find((p) => p.id === job.projectId);
          if (proj) {
            proj.activeVersionId = versionId;
            proj.updatedAt = now;
          }
        });

        for (const f of generatedFiles) {
          if (typeof f.path === 'string') {
            appendJobEvent(jobId, 'file_written', `Saved ${f.path.replace(/^\/+/, '')}`, {
              path: f.path.replace(/^\/+/, ''),
            });
          }
        }

        if (typeof parsedBuild.assistantReply === 'string' && parsedBuild.assistantReply.trim()) {
          mutateDb((db) => {
            db.chatMessages.push({
              id: generateId('msg'),
              projectId: job.projectId,
              role: 'assistant',
              content: String(parsedBuild.assistantReply),
              modelUsed: resolved.model.displayName,
              tokensUsed: callResult.totalTokens,
              latencyMs: callResult.latencyMs,
              createdAt: new Date().toISOString(),
            });
          });
        }
      } else {
        // Verification & QA step
        const latestHtml =
          getDb().projectFiles.find((f) => f.projectId === job.projectId && f.path === 'index.html')
            ?.content || '';

        callResult = await invokeModelAdapter({
          model: resolved.model,
          provider: resolved.provider,
          systemInstruction:
            'You are the VEKTOR Testing & Verification Agent. Review the generated HTML/JS for broken scripts, missing closing tags, or dead handlers. Return concise JSON: { verified: boolean, summary: string }.',
          prompt: `Audit this generated index.html (first 5000 chars) for syntax completeness and interactive readiness:\n\n${latestHtml.slice(0, 5000)}`,
          jsonSchema: {
            type: Type.OBJECT,
            properties: {
              verified: { type: Type.BOOLEAN },
              summary: { type: Type.STRING },
            },
          },
          signal: controller.signal,
        });
      }

      // Deduct actual credits atomically with idempotency key
      const stepCost = calculateCreditCost(
        resolved.model,
        callResult.promptTokens,
        callResult.completionTokens
      );
      const idempotencyKey = `job:${jobId}:step:${step.key}`;
      const walletRes = applyWalletCredit({
        userId: job.userId,
        amount: -stepCost,
        type: 'deduction',
        idempotencyKey,
        referenceId: jobId,
        description: `VEKTOR ${step.title} (${resolved.model.displayName})`,
        metadata: {
          projectId: job.projectId,
          modelId: resolved.model.id,
          tokens: callResult.totalTokens,
          latencyMs: callResult.latencyMs,
        },
      });

      if (!walletRes.ok) {
        mutateDb((db) => {
          const j = db.orchestrationJobs.find((x) => x.id === jobId);
          if (j) {
            j.status = 'paused_insufficient_credits';
            j.currentStepIndex = idx;
          }
          const p = db.projects.find((x) => x.id === job.projectId);
          if (p) p.status = 'paused_credits';
        });
        appendJobEvent(
          jobId,
          'job_paused',
          'Credits exhausted during execution. Files and checkpoint preserved.'
        );
        return;
      }

      mutateDb((db) => {
        const j = db.orchestrationJobs.find((x) => x.id === jobId);
        if (j) {
          const t = j.tasks[idx];
          if (t) {
            t.status = 'completed';
            t.actualModelUsed = resolved.model.id;
            t.latencyMs = callResult.latencyMs;
            t.tokensUsed = callResult.totalTokens;
            t.outputSummary = `Completed in ${callResult.latencyMs}ms · ${callResult.totalTokens} tokens`;
          }
          j.tokensUsed += callResult.totalTokens;
          j.creditsUsed += stepCost;
          j.latencyMs += callResult.latencyMs;
          j.currentStepIndex = idx + 1;
          j.updatedAt = new Date().toISOString();
        }
        const p = db.projects.find((x) => x.id === job.projectId);
        if (p) {
          p.totalTokensUsed += callResult.totalTokens;
          p.updatedAt = new Date().toISOString();
        }
      });

      appendJobEvent(
        jobId,
        'checkpoint_saved',
        `${step.title} completed via ${resolved.model.displayName} in ${callResult.latencyMs}ms (${callResult.totalTokens} tokens, ${stepCost} credits).`,
        {
          latencyMs: callResult.latencyMs,
          tokensUsed: callResult.totalTokens,
          creditsCharged: stepCost,
          balanceAfter: walletRes.balanceAfter,
        }
      );
    }

    mutateDb((db) => {
      const j = db.orchestrationJobs.find((x) => x.id === jobId);
      if (j) {
        j.status = 'completed';
        j.updatedAt = new Date().toISOString();
      }
      const p = db.projects.find((x) => x.id === job.projectId);
      if (p) {
        p.status = 'ready';
        p.updatedAt = new Date().toISOString();
      }
    });

    appendJobEvent(jobId, 'job_completed', 'VEKTOR AI finished orchestrating and packaging your application.');
  } catch (err) {
    if (controller.signal.aborted) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logSystemError('orchestrator', 'error', message, { jobId, projectId: job.projectId });
    mutateDb((db) => {
      const j = db.orchestrationJobs.find((x) => x.id === jobId);
      if (j) {
        j.status = 'failed';
        j.errorMessage = message;
        j.updatedAt = new Date().toISOString();
        const runningStep = j.tasks.find((t) => t.status === 'running');
        if (runningStep) runningStep.status = 'failed';
      }
      const p = db.projects.find((x) => x.id === job.projectId);
      if (p) {
        p.status = 'failed';
        p.updatedAt = new Date().toISOString();
      }
      db.chatMessages.push({
        id: generateId('msg'),
        projectId: job.projectId,
        role: 'system',
        content: `Orchestration halted: ${message}`,
        createdAt: new Date().toISOString(),
      });
    });
    appendJobEvent(jobId, 'job_error', message);
  } finally {
    activeJobControllers.delete(jobId);
  }
}
