import { createHash } from 'node:crypto';
import type { ProviderType } from '@aichat/shared';

export interface RequestDiagnostic {
  protocol: ProviderType;
  model: string;
  startedAt: string;
  durationMs: number;
  systemHash: string;
  toolsHash: string;
  settingsHash: string;
  messageHashes: string[];
  requestId?: string | null;
  responseId?: string;
  rawUsage?: Record<string, unknown>;
  status: 'complete' | 'error' | 'interrupted';
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

/** Cache markers move by design; compare actual content without mistaking them for edits. */
function withoutCacheMarkers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheMarkers);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cache_control').map(([key, v]) => [key, withoutCacheMarkers(v)]));
  return value;
}

export function requestDiagnostics(protocol: ProviderType, params: { model: string; messages: unknown[]; system?: unknown; tools?: unknown }, emit?: (d: RequestDiagnostic) => void) {
  if (!emit) return (_result: Pick<RequestDiagnostic, 'status' | 'rawUsage' | 'requestId' | 'responseId'>) => {};
  const started = Date.now();
  const { messages, system, tools, ...settings } = params;
  // OpenAI places system inside messages; keep a separate fingerprint for diagnosis.
  const systemMessages = messages.filter(m => (m as { role?: string }).role === 'system');
  const base = {
    protocol, model: params.model, startedAt: new Date(started).toISOString(),
    systemHash: hash(withoutCacheMarkers(system ?? systemMessages)),
    toolsHash: hash(withoutCacheMarkers(tools)), settingsHash: hash(settings),
    messageHashes: messages.map(m => hash(withoutCacheMarkers(m))),
  };
  return (result: Pick<RequestDiagnostic, 'status' | 'rawUsage' | 'requestId' | 'responseId'>) => {
    emit({ ...base, ...result, durationMs: Date.now() - started });
  };
}
