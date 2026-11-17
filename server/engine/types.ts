import type { AiModelRecord, AiProviderRecord } from '../types.ts';

export interface EngineChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EngineCompletionRequest {
  model: AiModelRecord;
  provider: AiProviderRecord;
  systemInstruction: string;
  prompt: string;
  messages?: EngineChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface EngineCompletionResult {
  text: string;
  modelUsed: string;
  providerName: string;
  providerKind: AiProviderRecord['kind'];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface EngineStreamCallbacks {
  onDelta: (textChunk: string) => void;
}

export interface EngineEmbeddingRequest {
  model: AiModelRecord;
  provider: AiProviderRecord;
  input: string[];
  signal?: AbortSignal;
}

export interface EngineEmbeddingResult {
  embeddings: number[][];
  modelUsed: string;
  providerName: string;
  providerKind: AiProviderRecord['kind'];
  promptTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface SelfHostedProbeResult {
  reachable: boolean;
  status: 'unconfigured' | 'weights_missing' | 'server_unreachable' | 'healthy';
  message: string;
  discoveredModels: string[];
  runtimeDetected: string | null;
  latencyMs: number | null;
}
