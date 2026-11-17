import { getDb, mutateDb } from '../db/store.ts';
import { probeSelfHostedServer } from '../engine/adapters/self-hosted-adapter.ts';
import type { SelfHostedModelConfig } from '../types.ts';

export async function validateSelfHostedModelHealth(): Promise<SelfHostedModelConfig> {
  const db = getDb();
  const cfg = db.selfHostedConfig;
  const now = new Date().toISOString();

  const serverUrl = (cfg.inferenceServerUrl || process.env.VEKTOR_INFERENCE_URL || '').trim();
  const weightsPath = (cfg.weightsPath || process.env.VEKTOR_MODEL_WEIGHTS_PATH || '').trim();
  const modelName = (cfg.modelName || process.env.VEKTOR_MODEL_NAME || 'vektor-coder-1').trim();
  const apiKey = process.env.VEKTOR_INFERENCE_API_KEY || null;

  const probe = await probeSelfHostedServer({
    serverUrl,
    weightsPath,
    apiKey,
  });

  return mutateDb((state) => {
    state.selfHostedConfig = {
      modelName,
      inferenceServerUrl: serverUrl ? serverUrl.replace(/\/+$/, '') : '',
      weightsPath,
      hasApiKey: Boolean(apiKey),
      status: probe.status,
      lastCheckedAt: now,
      lastMessage: probe.message,
      discoveredModels: probe.discoveredModels,
      runtimeDetected: probe.runtimeDetected,
      latencyMs: probe.latencyMs,
    };

    const prov = state.aiProviders.find((p) => p.id === 'prov_vektor_self_hosted');
    if (prov) {
      prov.baseUrl = serverUrl ? serverUrl.replace(/\/+$/, '') : null;
      prov.status =
        probe.status === 'healthy'
          ? 'available'
          : probe.status === 'unconfigured'
            ? 'unconfigured'
            : 'offline';
      prov.lastCheckedAt = now;
    }

    return state.selfHostedConfig;
  });
}
