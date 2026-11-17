import type {
  EngineCompletionRequest,
  EngineCompletionResult,
  EngineEmbeddingRequest,
  EngineEmbeddingResult,
  EngineStreamCallbacks,
} from '../types.ts';

function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

export async function runOpenAICompatibleCompletion(
  req: EngineCompletionRequest & { baseUrl: string; apiKey: string }
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, prompt, messages, jsonSchema, signal, baseUrl, apiKey, temperature, maxTokens } = req;
  const cleanUrl = normalizeBaseUrl(baseUrl);

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
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens;
  if (jsonSchema) body.response_format = { type: 'json_object' };

  const res = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider.name} returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new Error(`${provider.name} returned an empty completion`);
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

export async function streamOpenAICompatibleCompletion(
  req: EngineCompletionRequest & { baseUrl: string; apiKey: string },
  callbacks: EngineStreamCallbacks
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, prompt, messages, signal, baseUrl, apiKey, temperature, maxTokens } = req;
  const cleanUrl = normalizeBaseUrl(baseUrl);

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

  const res = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider.name} stream returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
        // Ignore malformed SSE lines
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

export async function runOpenAICompatibleEmbedding(
  req: EngineEmbeddingRequest & { baseUrl: string; apiKey: string }
): Promise<EngineEmbeddingResult> {
  const start = Date.now();
  const { model, provider, input, signal, baseUrl, apiKey } = req;
  const cleanUrl = normalizeBaseUrl(baseUrl);

  const res = await fetch(`${cleanUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.modelIdentifier,
      input,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider.name} embeddings returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };

  const embeddings = (data.data || [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding || []);

  if (embeddings.length === 0) {
    throw new Error(`${provider.name} returned no embeddings.`);
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
