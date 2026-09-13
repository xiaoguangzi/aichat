import type { ProviderType } from './types.js';

/** One HTTP attempt. SDK retries are separate records sharing a messageId. */
export interface ApiTrace {
  id: string;
  conversationId: string;
  turnId: string;
  messageId: string;
  providerId: string;
  providerName: string;
  purpose: 'chat' | 'title';
  protocol: ProviderType;
  model: string;
  attempt: number;
  startedAt: string;
  durationMs: number;
  status: 'running' | 'complete' | 'error' | 'interrupted';
  method: string;
  url: string;
  httpStatus?: number;
  requestId?: string | null;
  responseId?: string;
  rawUsage?: Record<string, unknown>;
  error?: string;
  bodyAvailable: boolean;
  /** Raw upstream bytes received so far; undefined until the first byte arrives. */
  responseBytes?: number;
  notes: string[];
}

export interface ApiTraceDetail extends ApiTrace {
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseHeaders: Record<string, string>;
  /** Raw response text (SSE or JSON) as received from the provider; null when unavailable. */
  responseBody: string | null;
}
