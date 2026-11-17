import { getDb } from '../db/store.ts';
import { decryptSecret } from '../lib/crypto.ts';
import type { AiModelRecord, AiProviderRecord, TaskType } from '../types.ts';
import type {
  EngineCompletionRequest,
  EngineCompletionResult,
  EngineEmbeddingRequest,
  EngineEmbeddingResult,
  EngineStreamCallbacks,
} from './types.ts';
import {
  runSelfHostedCompletion,
  streamSelfHostedCompletion,
  runSelfHostedEmbedding,
} from './adapters/self-hosted-adapter.ts';
import {
  runGeminiCompletion,
  streamGeminiCompletion,
  runGeminiEmbedding,
} from './adapters/gemini-adapter.ts';
import {
  runOpenAICompatibleCompletion,
  streamOpenAICompatibleCompletion,
  runOpenAICompatibleEmbedding,
} from './adapters/openai-compatible-adapter.ts';

// Clean AI Engine Layer — completely independent of Gateway auth, wallets, and billing.

const VEKTOR_MODEL_ALIASES: Record<string, string> = {
  'vektor-core-1': 'vektor-auto',
  'vektor-flash-1': 'gemini-4-hydrogen',
  'vektor-reasoning-1': 'gpt-4.1',
};

export function getProviderApiKey(provider: AiProviderRecord): string | null {
  if (provider.encryptedApiKey) {
    try {
      return decryptSecret(provider.encryptedApiKey);
    } catch {
      return null;
    }
  }
  if (provider.apiKeyEnvVar && process.env[provider.apiKeyEnvVar]) {
    return process.env[provider.apiKeyEnvVar] || null;
  }
  return null;
}

export function isProviderGenuinelyAvailable(provider: AiProviderRecord): boolean {
  if (!provider.enabled) return false;
  if (provider.kind === 'vektor_self_hosted') {
    const db = getDb();
    return Boolean(
      db.selfHostedConfig.inferenceServerUrl && db.selfHostedConfig.status === 'healthy'
    );
  }
  return Boolean(getProviderApiKey(provider));
}

export function isModelInstalledAndReady(model: AiModelRecord, provider?: AiProviderRecord): boolean {
  const db = getDb();
  const prov = provider || db.aiProviders.find((p) => p.id === model.providerId);
  if (!model.enabled || !prov) return false;
  return isProviderGenuinelyAvailable(prov);
}

export interface EngineRouteResolution {
  model: AiModelRecord;
  provider: AiProviderRecord;
  usedFallback: boolean;
  engineTier: 'self_hosted' | 'managed_upstream';
}

export interface EngineRouteOutcome {
  route: EngineRouteResolution | null;
  errorCode?: 'self_hosted_not_configured' | 'model_not_found' | 'provider_unavailable';
  errorMessage?: string;
}

export function resolveModelForTask(
  taskType: TaskType,
  preferredOverrideModelId?: string
): EngineRouteResolution | null {
  const outcome = resolveEngineRoute({
    taskType,
    requestedModelId: preferredOverrideModelId,
    allowFallbackOnExplicitSelfHosted: true,
  });
  return outcome.route;
}

export function resolveEngineRoute(params: {
  taskType: TaskType;
  requestedModelId?: string;
  allowFallbackOnExplicitSelfHosted?: boolean;
}): EngineRouteOutcome {
  const db = getDb();
  const { taskType, requestedModelId, allowFallbackOnExplicitSelfHosted = false } = params;

  const tryCandidate = (
    modelId: string | null | undefined
  ): { model: AiModelRecord; provider: AiProviderRecord } | null => {
    if (!modelId) return null;
    const model = db.aiModels.find(
      (m) => (m.id === modelId || m.modelIdentifier === modelId) && m.enabled
    );
    if (!model) return null;
    const provider = db.aiProviders.find((p) => p.id === model.providerId);
    if (!provider || !isProviderGenuinelyAvailable(provider)) return null;
    return { model, provider };
  };

  const normalizedRequested = requestedModelId
    ? VEKTOR_MODEL_ALIASES[requestedModelId] || requestedModelId
    : undefined;

  if (normalizedRequested && normalizedRequested !== 'vektor-auto') {
    const requestedModel = db.aiModels.find(
      (m) => (m.id === normalizedRequested || m.modelIdentifier === normalizedRequested) && m.enabled
    );

    if (requestedModel) {
      const requestedProvider = db.aiProviders.find((p) => p.id === requestedModel.providerId);
      if (requestedProvider && isProviderGenuinelyAvailable(requestedProvider)) {
        return {
          route: {
            model: requestedModel,
            provider: requestedProvider,
            usedFallback: false,
            engineTier:
              requestedProvider.kind === 'vektor_self_hosted' ? 'self_hosted' : 'managed_upstream',
          },
        };
      }

      // Honesty check: do not pretend an unconfigured self-hosted model is running!
      if (requestedProvider?.kind === 'vektor_self_hosted' && !allowFallbackOnExplicitSelfHosted) {
        return {
          route: null,
          errorCode: 'self_hosted_not_configured',
          errorMessage: `Self-hosted model "${requestedModel.id}" is not installed or running on this server (${db.selfHostedConfig.lastMessage}). Configure VEKTOR_INFERENCE_URL, pass allow_fallback: true, or select "vektor-auto" to route via an available engine.`,
        };
      }
    }
  }

  // Prefer healthy self-hosted engine automatically when routing via vektor-auto
  const selfHostedProv = db.aiProviders.find((p) => p.kind === 'vektor_self_hosted');
  if (selfHostedProv && isProviderGenuinelyAvailable(selfHostedProv)) {
    const shPreferred =
      db.aiModels.find(
        (m) => m.providerId === selfHostedProv.id && m.enabled && (taskType === 'coding' ? m.isPreferredCoding : true)
      ) || db.aiModels.find((m) => m.providerId === selfHostedProv.id && m.enabled);
    if (shPreferred) {
      return {
        route: {
          model: shPreferred,
          provider: selfHostedProv,
          usedFallback: false,
          engineTier: 'self_hosted',
        },
      };
    }
  }

  const rule = db.taskRoutingRules.find((r) => r.taskType === taskType);
  if (rule) {
    const primary = tryCandidate(rule.primaryModelId);
    if (primary) {
      return {
        route: {
          ...primary,
          usedFallback: false,
          engineTier:
            primary.provider.kind === 'vektor_self_hosted' ? 'self_hosted' : 'managed_upstream',
        },
      };
    }
    const fallback = tryCandidate(rule.fallbackModelId);
    if (fallback) {
      return {
        route: {
          ...fallback,
          usedFallback: true,
          engineTier:
            fallback.provider.kind === 'vektor_self_hosted' ? 'self_hosted' : 'managed_upstream',
        },
      };
    }
  }

  // Last-resort check across enabled models with active server credentials
  for (const model of db.aiModels) {
    if (!model.enabled) continue;
    const provider = db.aiProviders.find((p) => p.id === model.providerId);
    if (provider && isProviderGenuinelyAvailable(provider)) {
      return {
        route: {
          model,
          provider,
          usedFallback: true,
          engineTier: provider.kind === 'vektor_self_hosted' ? 'self_hosted' : 'managed_upstream',
        },
      };
    }
  }

  return {
    route: null,
    errorCode: 'provider_unavailable',
    errorMessage:
      'No AI inference engine is currently configured on the server. Connect a self-hosted inference server (VEKTOR_INFERENCE_URL) or configure a server-side provider key.',
  };
}

export async function executeEngineCompletion(
  req: EngineCompletionRequest
): Promise<EngineCompletionResult> {
  const { provider } = req;
  const apiKey = getProviderApiKey(provider);

  if (provider.kind === 'vektor_self_hosted') {
    const serverUrl = (getDb().selfHostedConfig.inferenceServerUrl || provider.baseUrl || '').trim();
    if (!serverUrl) {
      throw new Error('Self-hosted VEKTOR inference server URL is not configured.');
    }
    return runSelfHostedCompletion({ ...req, serverUrl, apiKey });
  }

  if (provider.kind === 'gemini') {
    if (!apiKey) {
      throw new Error(`Provider ${provider.name} is missing server credentials.`);
    }
    return runGeminiCompletion({ ...req, apiKey });
  }

  const baseUrl = (provider.baseUrl || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(`Provider ${provider.name} is not configured with baseUrl and API key.`);
  }
  return runOpenAICompatibleCompletion({ ...req, baseUrl, apiKey });
}

export async function streamEngineCompletion(
  req: EngineCompletionRequest,
  callbacks: EngineStreamCallbacks
): Promise<EngineCompletionResult> {
  const { provider } = req;
  const apiKey = getProviderApiKey(provider);

  if (provider.kind === 'vektor_self_hosted') {
    const serverUrl = (getDb().selfHostedConfig.inferenceServerUrl || provider.baseUrl || '').trim();
    if (!serverUrl) {
      throw new Error('Self-hosted VEKTOR inference server URL is not configured.');
    }
    return streamSelfHostedCompletion({ ...req, serverUrl, apiKey }, callbacks);
  }

  if (provider.kind === 'gemini') {
    if (!apiKey) {
      throw new Error(`Provider ${provider.name} is missing server credentials.`);
    }
    return streamGeminiCompletion({ ...req, apiKey }, callbacks);
  }

  const baseUrl = (provider.baseUrl || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(`Provider ${provider.name} is not configured with baseUrl and API key.`);
  }
  return streamOpenAICompatibleCompletion({ ...req, baseUrl, apiKey }, callbacks);
}

export async function executeEngineEmbedding(
  req: EngineEmbeddingRequest
): Promise<EngineEmbeddingResult> {
  const { provider } = req;
  const apiKey = getProviderApiKey(provider);

  if (provider.kind === 'vektor_self_hosted') {
    const serverUrl = (getDb().selfHostedConfig.inferenceServerUrl || provider.baseUrl || '').trim();
    if (!serverUrl) {
      throw new Error('Self-hosted VEKTOR inference server URL is not configured.');
    }
    return runSelfHostedEmbedding({ ...req, serverUrl, apiKey });
  }

  if (provider.kind === 'gemini') {
    if (!apiKey) {
      throw new Error(`Provider ${provider.name} is missing server credentials.`);
    }
    return runGeminiEmbedding({ ...req, apiKey });
  }

  const baseUrl = (provider.baseUrl || '').trim();
  if (!baseUrl || !apiKey) {
    throw new Error(`Provider ${provider.name} is not configured for embeddings.`);
  }
  return runOpenAICompatibleEmbedding({ ...req, baseUrl, apiKey });
}
