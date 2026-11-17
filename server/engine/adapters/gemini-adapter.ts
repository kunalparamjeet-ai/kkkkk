import { GoogleGenAI } from '@google/genai';
import type {
  EngineCompletionRequest,
  EngineCompletionResult,
  EngineEmbeddingRequest,
  EngineEmbeddingResult,
  EngineStreamCallbacks,
} from '../types.ts';

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatPromptInput(req: EngineCompletionRequest): string {
  if (req.messages && req.messages.length > 0) {
    return req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');
  }
  return req.prompt;
}

export async function runGeminiCompletion(
  req: EngineCompletionRequest & { apiKey: string }
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, jsonSchema, signal, apiKey } = req;
  const ai = createGeminiClient(apiKey);
  const promptText = formatPromptInput(req);

  const config: Record<string, unknown> = {
    systemInstruction,
  };
  if (jsonSchema) {
    config.responseMimeType = 'application/json';
    config.responseSchema = jsonSchema;
  }

  const response = await ai.models.generateContent({
    model: model.modelIdentifier,
    contents: promptText,
    config,
  });

  if (signal?.aborted) {
    throw new Error('Job aborted by user');
  }

  const latencyMs = Date.now() - start;
  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error(`Empty response received from ${model.displayName}`);
  }

  const usage = response.usageMetadata;
  const promptTokens =
    usage?.promptTokenCount ?? Math.ceil((systemInstruction.length + promptText.length) / 4);
  const completionTokens = usage?.candidatesTokenCount ?? Math.ceil(text.length / 4);

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

export async function streamGeminiCompletion(
  req: EngineCompletionRequest & { apiKey: string },
  callbacks: EngineStreamCallbacks
): Promise<EngineCompletionResult> {
  const start = Date.now();
  const { model, provider, systemInstruction, signal, apiKey } = req;
  const ai = createGeminiClient(apiKey);
  const promptText = formatPromptInput(req);

  const stream = await ai.models.generateContentStream({
    model: model.modelIdentifier,
    contents: promptText,
    config: {
      systemInstruction,
    },
  });

  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    if (signal?.aborted) {
      throw new Error('Stream aborted by client');
    }
    const delta = chunk.text ?? '';
    if (delta) {
      fullText += delta;
      callbacks.onDelta(delta);
    }
    if (chunk.usageMetadata?.promptTokenCount) {
      promptTokens = chunk.usageMetadata.promptTokenCount;
    }
    if (chunk.usageMetadata?.candidatesTokenCount) {
      completionTokens = chunk.usageMetadata.candidatesTokenCount;
    }
  }

  const latencyMs = Date.now() - start;
  const estPrompt =
    promptTokens || Math.ceil((systemInstruction.length + promptText.length) / 4);
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

export async function runGeminiEmbedding(
  req: EngineEmbeddingRequest & { apiKey: string }
): Promise<EngineEmbeddingResult> {
  const start = Date.now();
  const { model, provider, input, apiKey } = req;
  const ai = createGeminiClient(apiKey);
  const targetModel =
    model.modelIdentifier.includes('embedding') ? model.modelIdentifier : 'gemini-embedding-2';

  const embeddings: number[][] = [];
  for (const text of input) {
    const res = await ai.models.embedContent({
      model: targetModel,
      contents: text,
    });
    const values = res.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error('Empty embedding vector returned by managed upstream model.');
    }
    embeddings.push(values);
  }

  const promptTokens = Math.ceil(input.join(' ').length / 4);
  return {
    embeddings,
    modelUsed: model.id,
    providerName: provider.name,
    providerKind: provider.kind,
    promptTokens,
    totalTokens: promptTokens,
    latencyMs: Date.now() - start,
  };
}
