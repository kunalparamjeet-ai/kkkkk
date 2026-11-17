import fs from 'node:fs';
import type {
  EngineCompletionRequest,
  EngineCompletionResult,
  EngineEmbeddingRequest,
  EngineEmbeddingResult,
  EngineStreamCallbacks,
  SelfHostedProbeResult,
} from '../types.ts';

function normalizeInferenceBase(rawUrl: string): { rootUrl: string; v1BaseUrl: string } {
  const clean = rawUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/v1')) {
    return {
      rootUrl: clean.slice(0, -3),
      v1BaseUrl: clean,
    };
  }
  return {
    rootUrl: clean,
    v1BaseUrl: `${clean}/v1`,
  };
}

function buildAuthHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function probeSelfHostedServer(params: {
  serverUrl: string;
  weightsPath: string;
  apiKey: string | null;
}): Promise<SelfHostedProbeResult> {
  const { serverUrl, weightsPath, apiKey } = params;
  const trimmedUrl = serverUrl.trim();
  const trimmedWeights = weightsPath.trim();

  if (!trimmedUrl && !trimmedWeights) {
    return {
      reachable: false,
      status: 'unconfigured',
      message:
        'No self-hosted open-source inference server is installed or configured on this instance. Set VEKTOR_INFERENCE_URL (e.g. vLLM, Ollama, or llama.cpp) to run independently without external API keys.',
      discoveredModels: [],
      runtimeDetected: null,
      latencyMs: null,
    };
  }

  if (
    trimmedWeights &&
    !trimmedWeights.startsWith('s3://') &&
    !trimmedWeights.startsWith('gs://') &&
    !trimmedWeights.startsWith('hf://') &&
    !trimmedWeights.startsWith('ollama://')
  ) {
    if (!fs.existsSync(trimmedWeights)) {
      return {
        reachable: false,
        status: 'weights_missing',
        message: `Model weights path not found on disk: ${trimmedWeights}`,
        discoveredModels: [],
        runtimeDetected: null,
        latencyMs: null,
      };
    }
  }

  if (!trimmedUrl) {
    return {
      reachable: false,
      status: 'server_unreachable',
      message: 'Weights path is present, but VEKTOR_INFERENCE_URL is missing.',
      discoveredModels: [],
      runtimeDetected: null,
      latencyMs: null,
    };
  }

  const { rootUrl, v1BaseUrl } = normalizeInferenceBase(trimmedUrl);
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const start = Date.now();
  const discoveredModels: string[] = [];
  let runtimeDetected: string | null = null;
  let anyOk = false;

  const fetchWithTimeout = async (url: string, ms = 3500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // 1. Probe OpenAI-compatible /v1/models (vLLM, llama.cpp, SGLang, Ollama /v1, TGI)
    const modelsRes = await fetchWithTimeout(`${v1BaseUrl}/models`).catch(() => null);
    if (modelsRes && modelsRes.ok) {
      anyOk = true;
      runtimeDetected = 'OpenAI-Compatible Inference Server';
      const body = (await modelsRes.json().catch(() => null)) as {
        data?: Array<{ id?: string; owned_by?: string }>;
      } | null;
      if (Array.isArray(body?.data)) {
        for (const item of body.data) {
          if (typeof item.id === 'string' && item.id.trim()) {
            discoveredModels.push(item.id.trim());
          }
        }
      }
    }

    // 2. Probe Ollama native /api/tags if no models found yet
    if (discoveredModels.length === 0) {
      const ollamaRes = await fetchWithTimeout(`${rootUrl}/api/tags`).catch(() => null);
      if (ollamaRes && ollamaRes.ok) {
        anyOk = true;
        runtimeDetected = 'Ollama Inference Server';
        const body = (await ollamaRes.json().catch(() => null)) as {
          models?: Array<{ name?: string; model?: string }>;
        } | null;
        if (Array.isArray(body?.models)) {
          for (const item of body.models) {
            const name = item.name || item.model;
            if (typeof name === 'string' && name.trim()) {
              discoveredModels.push(name.trim());
            }
          }
        }
      }
    }

    // 3. Fallback health endpoint probe (/health)
    if (!anyOk) {
      const healthRes = await fetchWithTimeout(`${rootUrl}/health`).catch(() => null);
      if (healthRes && healthRes.ok) {
        anyOk = true;
        runtimeDetected = 'Custom Self-Hosted Inference Server';
      }
    }

    const latencyMs = Date.now() - start;

    if (anyOk) {
      const uniqueModels = Array.from(new Set(discoveredModels));
      return {
        reachable: true,
        status: 'healthy',
        message:
          uniqueModels.length > 0
            ? `Connected to ${runtimeDetected || 'self-hosted inference server'} (${rootUrl}) · ${uniqueModels.length} model(s) loaded: ${uniqueModels.slice(0, 4).join(', ')}`
            : `Connected to self-hosted inference server (${rootUrl})`,
        discoveredModels: uniqueModels,
        runtimeDetected,
        latencyMs,
      };
    }

    return {
      reachable: false,
      status: 'server_unreachable',
      message: `Inference server at ${rootUrl} did not respond with 2xx status on /v1/models or /health.`,
      discoveredModels: [],
      runtimeDetected: null,
      latencyMs: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      status: 'server_unreachable',
      message: `Inference server unreachable at ${rootUrl}: ${msg}`,
      discoveredModels: [],
      runtimeDetected: null,
      latencyMs: null,
    };
  }
}

export async function runSelfHostedCompletion(
  req: EngineCompletionRequest & { serverUrl: string; apiKey: string | null }
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, prompt, messages, jsonSchema, signal, serverUrl, apiKey, temperature, maxTokens } = req;
  const { v1BaseUrl } = normalizeInferenceBase(serverUrl);

  const outboundMessages =
    messages && messages.length > 0
      ? [
          ...(messages.some((m) => m.role === 'system') ? [] : [{ role: 'system', content: systemInstruction }]),
          ...messages,
        ]
      : [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ];

  const body: Record<string, unknown> = {
    model: model.modelIdentifier,
    messages: outboundMessages,
    stream: false,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
  if (jsonSchema) body.response_format = { type: 'json_object' };

  const res = await fetch(`${v1BaseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Self-hosted inference server returned HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new Error('Self-hosted inference server returned an empty completion.');
  }

  const latencyMs = Date.now() - start;
  const promptTokens =
    data.usage?.prompt_tokens ?? Math.ceil((systemInstruction.length + prompt.length) / 4);
  const completionTokens = data.usage?.completion_tokens ?? Math.ceil(text.length / 4);

  return {
    text,
    modelUsed: model.id,
    providerName: provider.name,
    providerKind: provider.kind,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs,
  };
}

export async function streamSelfHostedCompletion(
  req: EngineCompletionRequest & { serverUrl: string; apiKey: string | null },
  callbacks: EngineStreamCallbacks
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, prompt, messages, signal, serverUrl, apiKey, temperature, maxTokens } = req;
  const { v1BaseUrl } = normalizeInferenceBase(serverUrl);

  const outboundMessages =
    messages && messages.length > 0
      ? [
          ...(messages.some((m) => m.role === 'system') ? [] : [{ role: 'system', content: systemInstruction }]),
          ...messages,
        ]
      : [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ];

  const body: Record<string, unknown> = {
    model: model.modelIdentifier,
    messages: outboundMessages,
    stream: true,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens;

  const res = await fetch(`${v1BaseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Self-hosted inference stream returned HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          fullText += delta;
          callbacks.onDelta(delta);
        }
        if (parsed.usage?.prompt_tokens) promptTokens = parsed.usage.prompt_tokens;
        if (parsed.usage?.completion_tokens) completionTokens = parsed.usage.completion_tokens;
      } catch {
        // Skip partial/malformed SSE comment or frame
      }
    }
  }

  const latencyMs = Date.now() - start;
  const estPrompt = promptTokens || Math.ceil((systemInstruction.length + prompt.length) / 4);
  const estComp = completionTokens || Math.ceil(fullText.length / 4);

  return {
    text: fullText,
    modelUsed: model.id,
    providerName: provider.name,
    providerKind: provider.kind,
    promptTokens: estPrompt,
    completionTokens: estComp,
    totalTokens: estPrompt + estComp,
    latencyMs,
  };
}

export async function runSelfHostedEmbedding(
  req: EngineEmbeddingRequest & { serverUrl: string; apiKey: string | null }
): Promise<EngineEmbeddingResult> {
  const start = Date.now();
  const { model, provider, input, signal, serverUrl, apiKey } = req;
  const { v1BaseUrl } = normalizeInferenceBase(serverUrl);

  const res = await fetch(`${v1BaseUrl}/embeddings`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify({
      model: model.modelIdentifier,
      input,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Self-hosted embeddings returned HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };

  const embeddings = (data.data || [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding || []);

  if (embeddings.length === 0) {
    throw new Error('Self-hosted inference server returned no embeddings.');
  }

  const promptTokens =
    data.usage?.prompt_tokens ?? Math.ceil(input.join(' ').length / 4);

  return {
    embeddings,
    modelUsed: model.id,
    providerName: provider.name,
    providerKind: provider.kind,
    promptTokens,
    totalTokens: data.usage?.total_tokens ?? promptTokens,
    latencyMs: Date.now() - start,
  };
}
