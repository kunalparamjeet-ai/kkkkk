import { Router } from 'express';
import JSZip from 'jszip';
import { getDb, mutateDb, getOrCreateWallet } from '../db/store.ts';
import { generateId } from '../lib/crypto.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  jobEventsEmitter,
  startOrResumeOrchestrationJob,
  stopOrchestrationJob,
} from '../services/ai-orchestrator.ts';
import { executeEngineCompletion, resolveEngineRoute } from '../engine/router.ts';
import type { OrchestrationJobRecord, ProjectRecord } from '../types.ts';

const router = Router();

function inferLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs') return 'javascript';
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
}

router.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const projects = db.projects
    .filter((p) => p.userId === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((p) => {
      const deployment = db.deployments.find((d) => d.projectId === p.id);
      const fileCount = db.projectFiles.filter((f) => f.projectId === p.id).length;
      return {
        ...p,
        fileCount,
        liveUrl: deployment?.liveUrl || null,
      };
    });

  res.json({ projects });
});

router.post('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, description, prompt, selectedModelId } = req.body || {};
  const now = new Date().toISOString();

  const db = getDb();
  const sub = db.subscriptions.find((s) => s.userId === user.id && s.status === 'active');
  const plan = sub ? db.plans.find((p) => p.id === sub.planId) : db.plans.find((p) => p.slug === 'free');
  const userProjects = db.projects.filter((p) => p.userId === user.id);

  if (plan && userProjects.length >= plan.maxProjects && user.role === 'user') {
    res.status(403).json({
      error: `Project limit reached (${plan.maxProjects} projects on ${plan.name} plan). Upgrade your plan to create more.`,
    });
    return;
  }

  const projectId = generateId('prj');
  const rawName =
    typeof name === 'string' && name.trim().length > 0
      ? name.trim().slice(0, 60)
      : typeof prompt === 'string' && prompt.trim().length > 0
        ? prompt.trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 50)
        : 'Untitled Project';

  const project: ProjectRecord = {
    id: projectId,
    userId: user.id,
    name: rawName,
    description: typeof description === 'string' ? description.slice(0, 300) : '',
    status: 'draft',
    selectedModelId: typeof selectedModelId === 'string' ? selectedModelId : 'vektor-auto',
    previewSlug: null,
    activeVersionId: null,
    totalTokensUsed: 0,
    githubRepoFullName: null,
    githubBranch: null,
    createdAt: now,
    updatedAt: now,
  };

  mutateDb((state) => {
    state.projects.unshift(project);
    state.projectFiles.push({
      id: generateId('file'),
      projectId,
      path: 'index.html',
      language: 'html',
      content: `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${rawName}</title></head>\n<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafafa;color:#18181b;">\n  <div style="text-align:center;max-width:420px;padding:24px;">\n    <h1 style="font-size:20px;margin:0 0 8px;">${rawName}</h1>\n    <p style="color:#52525b;font-size:14px;margin:0;">Ready for VEKTOR AI orchestration.</p>\n  </div>\n</body>\n</html>`,
      updatedAt: now,
    });
  });

  res.status(201).json({ project });
});

router.get('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const project = db.projects.find(
    (p) => p.id === req.params.id && (p.userId === user.id || user.role !== 'user')
  );
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const files = db.projectFiles.filter((f) => f.projectId === project.id);
  const messages = db.chatMessages.filter((m) => m.projectId === project.id);
  const versions = db.projectVersions
    .filter((v) => v.projectId === project.id)
    .sort((a, b) => b.versionNumber - a.versionNumber);
  const jobs = db.orchestrationJobs
    .filter((j) => j.projectId === project.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const deployments = db.deployments
    .filter((d) => d.projectId === project.id)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const domains = db.customDomains.filter((d) => d.projectId === project.id);

  res.json({
    project,
    files,
    messages,
    versions,
    jobs,
    deployments,
    domains,
  });
});

router.patch('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, selectedModelId, description } = req.body || {};
  const updated = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return null;
    if (typeof name === 'string' && name.trim()) project.name = name.trim().slice(0, 60);
    if (typeof description === 'string') project.description = description.slice(0, 300);
    if (typeof selectedModelId === 'string') project.selectedModelId = selectedModelId;
    project.updatedAt = new Date().toISOString();
    return project;
  });
  if (!updated) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ project: updated });
});

router.delete('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const deleted = mutateDb((db) => {
    const idx = db.projects.findIndex((p) => p.id === req.params.id && p.userId === user.id);
    if (idx < 0) return false;
    const pid = db.projects[idx].id;
    db.projects.splice(idx, 1);
    db.projectFiles = db.projectFiles.filter((f) => f.projectId !== pid);
    db.projectVersions = db.projectVersions.filter((v) => v.projectId !== pid);
    db.chatMessages = db.chatMessages.filter((m) => m.projectId !== pid);
    db.orchestrationJobs = db.orchestrationJobs.filter((j) => j.projectId !== pid);
    db.deployments = db.deployments.filter((d) => d.projectId !== pid);
    db.customDomains = db.customDomains.filter((d) => d.projectId !== pid);
    return true;
  });
  if (!deleted) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/:id/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const removed = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return false;
    const before = db.chatMessages.length;
    db.chatMessages = db.chatMessages.filter(
      (m) => !(m.projectId === project.id && m.id === req.params.messageId)
    );
    if (db.chatMessages.length < before) {
      project.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  });
  if (!removed) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const cleared = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return false;
    db.chatMessages = db.chatMessages.filter((m) => m.projectId !== project.id);
    db.orchestrationJobs = db.orchestrationJobs.filter((j) => j.projectId !== project.id);
    project.updatedAt = new Date().toISOString();
    return true;
  });
  if (!cleared) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ ok: true });
});

router.post('/suggest', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { prompt, projectId, mode } = req.body || {};
  const db = getDb();
  const project = projectId
    ? db.projects.find((p) => p.id === projectId && p.userId === user.id)
    : null;
  const projectFiles = project
    ? db.projectFiles.filter((f) => f.projectId === project.id).map((f) => f.path)
    : [];

  const fallbackSuggestions = project && projectFiles.length > 1
    ? [
        'Refine responsive mobile navigation and tighten section spacing',
        'Add interactive filtering, search, and persistent state across tabs',
        'Enhance empty states, form validation, and keyboard accessibility',
        'Polish typography, contrast ratios, and dark/light theme transitions',
      ]
    : [
        'Build a SaaS analytics dashboard with KPI cards, 14-day revenue chart, and filterable ledger',
        'Create a minimalist developer portfolio and case-study showcase with dark/light mode',
        'Design an interactive invoice & client billing portal with PDF-ready print view',
        'Build a multi-step customer onboarding and workspace settings flow with live validation',
      ];

  const userPrompt = typeof prompt === 'string' ? prompt.trim() : '';

  if (mode === 'refine' && userPrompt) {
    const outcome = resolveEngineRoute({ taskType: 'orchestration', allowFallbackOnExplicitSelfHosted: true });
    if (outcome.route) {
      try {
        const result = await executeEngineCompletion({
          model: outcome.route.model,
          provider: outcome.route.provider,
          systemInstruction:
            'You are a senior product engineer. Rewrite the user prompt into a concise, high-signal, single-paragraph application build specification specifying layout, responsive behavior, and key interactive states. Output ONLY the improved prompt text, no markdown fences.',
          prompt: `Original prompt: ${userPrompt}\nExisting files: ${projectFiles.join(', ') || 'none'}`,
        });
        res.json({ refinedPrompt: result.text.trim(), suggestions: fallbackSuggestions });
        return;
      } catch {
        // Fall through to deterministic refinement
      }
    }
    const refined = `${userPrompt}. Include a clean responsive layout for desktop, tablet, and mobile, clear typographic hierarchy, accessible form and button states, interactive filtering/editing, and cohesive light/dark surface tokens.`;
    res.json({ refinedPrompt: refined, suggestions: fallbackSuggestions });
    return;
  }

  res.json({ suggestions: fallbackSuggestions });
});

router.post('/:id/files', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { path: filePath, content } = req.body || {};
  if (typeof filePath !== 'string' || !filePath.trim() || typeof content !== 'string') {
    res.status(400).json({ error: 'File path and content are required.' });
    return;
  }
  const cleanPath = filePath.trim().replace(/^\/+/, '');
  const now = new Date().toISOString();

  const file = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return null;
    let existing = db.projectFiles.find((f) => f.projectId === project.id && f.path === cleanPath);
    if (existing) {
      existing.content = content;
      existing.language = inferLang(cleanPath);
      existing.updatedAt = now;
    } else {
      existing = {
        id: generateId('file'),
        projectId: project.id,
        path: cleanPath,
        content,
        language: inferLang(cleanPath),
        updatedAt: now,
      };
      db.projectFiles.push(existing);
    }
    project.updatedAt = now;
    return existing;
  });

  if (!file) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ file });
});

router.delete('/:id/files', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const filePath = typeof req.query.path === 'string' ? req.query.path : '';
  if (!filePath) {
    res.status(400).json({ error: 'Query parameter "path" is required.' });
    return;
  }
  const removed = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return false;
    const before = db.projectFiles.length;
    db.projectFiles = db.projectFiles.filter((f) => !(f.projectId === project.id && f.path === filePath));
    return db.projectFiles.length < before;
  });
  if (!removed) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  res.json({ ok: true });
});

router.get('/:id/download', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const files = db.projectFiles.filter((f) => f.projectId === project.id);
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vektor-project';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
  res.send(buffer);
});

router.post('/:id/generate', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { prompt, modelId } = req.body || {};
  if (typeof prompt !== 'string' || prompt.trim().length < 2) {
    res.status(400).json({ error: 'Prompt is required.' });
    return;
  }

  const wallet = getOrCreateWallet(user.id);
  if (wallet.balanceCredits < 5) {
    res.status(402).json({
      error: 'Insufficient credits. Top up your wallet to start orchestration.',
      balanceCredits: wallet.balanceCredits,
    });
    return;
  }

  const db = getDb();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const now = new Date().toISOString();
  const jobId = generateId('job');
  const requestedModelId = typeof modelId === 'string' && modelId ? modelId : project.selectedModelId || 'vektor-auto';

  const newJob: OrchestrationJobRecord = {
    id: jobId,
    projectId: project.id,
    userId: user.id,
    prompt: prompt.trim(),
    requestedModelId,
    status: 'queued',
    currentStepIndex: 0,
    tasks: [],
    events: [],
    tokensUsed: 0,
    creditsUsed: 0,
    latencyMs: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  mutateDb((state) => {
    const p = state.projects.find((x) => x.id === project.id);
    if (p) {
      p.selectedModelId = requestedModelId;
      p.status = 'building';
      p.updatedAt = now;
    }
    state.chatMessages.push({
      id: generateId('msg'),
      projectId: project.id,
      role: 'user',
      content: prompt.trim(),
      createdAt: now,
    });
    state.orchestrationJobs.unshift(newJob);
  });

  startOrResumeOrchestrationJob(jobId);
  res.status(202).json({ job: newJob });
});

router.get('/jobs/:jobId/stream', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const job = db.orchestrationJobs.find((j) => j.id === req.params.jobId && j.userId === user.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'snapshot', job })}\n\n`);

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped' || job.status === 'paused_insufficient_credits') {
    res.end();
    return;
  }

  const listener = (payload: { event: unknown; job: OrchestrationJobRecord }) => {
    res.write(`data: ${JSON.stringify({ type: 'update', ...payload })}\n\n`);
    if (
      payload.job &&
      ['completed', 'failed', 'stopped', 'paused_insufficient_credits'].includes(payload.job.status)
    ) {
      cleanup();
      res.end();
    }
  };

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  const cleanup = () => {
    clearInterval(keepAlive);
    jobEventsEmitter.off(`job:${job.id}`, listener);
  };

  jobEventsEmitter.on(`job:${job.id}`, listener);
  req.on('close', cleanup);
});

router.post('/jobs/:jobId/stop', requireAuth, (req: AuthenticatedRequest, res) => {
  const job = stopOrchestrationJob(req.params.jobId, req.user!.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({ job });
});

router.post('/jobs/:jobId/resume', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const job = db.orchestrationJobs.find((j) => j.id === req.params.jobId && j.userId === user.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  const wallet = getOrCreateWallet(user.id);
  if (wallet.balanceCredits < 5) {
    res.status(402).json({
      error: 'Credits still insufficient. Please top up your wallet to resume.',
      balanceCredits: wallet.balanceCredits,
    });
    return;
  }
  if (job.status !== 'paused_insufficient_credits' && job.status !== 'stopped' && job.status !== 'failed') {
    res.status(400).json({ error: `Job cannot be resumed from status "${job.status}".` });
    return;
  }
  startOrResumeOrchestrationJob(job.id);
  res.json({ ok: true, jobId: job.id });
});

router.post('/:id/versions/:versionId/restore', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const now = new Date().toISOString();

  const restored = mutateDb((db) => {
    const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
    if (!project) return null;
    const version = db.projectVersions.find(
      (v) => v.id === req.params.versionId && v.projectId === project.id
    );
    if (!version) return null;

    db.projectFiles = db.projectFiles.filter((f) => f.projectId !== project.id);
    for (const snap of version.filesSnapshot) {
      db.projectFiles.push({
        id: generateId('file'),
        projectId: project.id,
        path: snap.path,
        content: snap.content,
        language: snap.language,
        updatedAt: now,
      });
    }
    project.activeVersionId = version.id;
    project.updatedAt = now;
    return { project, version, files: db.projectFiles.filter((f) => f.projectId === project.id) };
  });

  if (!restored) {
    res.status(404).json({ error: 'Project or version not found.' });
    return;
  }
  res.json(restored);
});

export default router;
