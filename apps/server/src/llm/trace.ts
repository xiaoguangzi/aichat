import { randomUUID, createHash } from 'node:crypto';
import type { ApiTraceDetail } from '@aichat/shared';
import type { ProviderSecret } from '../db/repos/providers.js';
import type { RequestDiagnostic } from './diagnostics.js';

export type TraceAttempt = Omit<ApiTraceDetail, 'conversationId' | 'turnId' | 'messageId' | 'providerId' | 'providerName' | 'purpose'>;
export type TraceSink = (record: TraceAttempt) => void;

/** Raw response text kept per attempt; a streamed reply is a few hundred KB at most. */
export const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
const RESPONSE_HEADERS = ['content-type', 'request-id', 'x-request-id', 'anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-tokens-remaining', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens', 'retry-after'];

/** Request-scoped fetch: observes the SDK's serialized body and the raw response, including every retry. */
export function traceRequests(provider: ProviderSecret, model: string, emit?: TraceSink) {
  const secrets = [provider.apiKey, ...Object.values(provider.extraHeaders)].filter(Boolean);
  const cleanString = (value: string) => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  const sanitize = (value: unknown, notes: Set<string>, key = '', media = false): unknown => {
    if (/^(authorization|proxy-authorization|x-api-key|api[_-]?key|password|access[_-]?token|refresh[_-]?token|cookie|set-cookie)$/i.test(key)) {
      notes.add('凭据字段已脱敏');
      return '[REDACTED]';
    }
    if (typeof value === 'string') {
      if (media || /^data:[^,]*;base64,/i.test(value)) {
        notes.add('内嵌媒体以长度和 SHA-256 代替');
        return `[media: ${value.length} chars; sha256=${createHash('sha256').update(value).digest('hex')}]`;
      }
      const cleaned = cleanString(value);
      if (cleaned !== value) notes.add('供应商凭据已脱敏');
      return cleaned;
    }
    if (Array.isArray(value)) return value.map(v => sanitize(v, notes));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [cleanString(k), sanitize(v, notes, k, k === 'data' && (value as { type?: string }).type === 'base64')]));
    return value;
  };
  let current: TraceAttempt | undefined;
  let attempt = 0;
  const publish = () => { if (current && emit) { try { emit(structuredClone(current)); } catch { console.warn('Could not save local API trace.'); } } };
  const addNote = (record: TraceAttempt, note: string) => { if (!record.notes.includes(note)) record.notes.push(note); };

  /** Copies the body as the SDK consumes it, so the trace never delays or alters the stream. */
  const observe = (record: TraceAttempt, response: Response): Response => {
    if (!response.body) return response;
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    const done = (interrupted: boolean) => {
      text += decoder.decode();
      record.responseBody = cleanString(text);
      record.responseBytes = bytes;
      // SDKs may cancel the body after the final event; only a still-running attempt was cut short.
      if (interrupted && record.status === 'running') addNote(record, '响应流在结束前中断，原始响应可能不完整');
      publish();
    };
    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (text.length < MAX_RESPONSE_CHARS) text += decoder.decode(chunk, { stream: true });
        else addNote(record, `原始响应超过 ${MAX_RESPONSE_CHARS / 1024 / 1024} MiB，仅保留开头`);
        controller.enqueue(chunk);
      },
      flush() { done(false); },
      cancel() { done(true); },
    });
    return new Response(response.body.pipeThrough(tap), { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const fetchAttempt: typeof fetch = async (input, init) => {
    const started = Date.now();
    const notes = new Set<string>();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.username || url.password || url.search) notes.add('URL 凭据和查询参数值已隐藏');
    url.username = ''; url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestHeaders: Record<string, string> = {};
    for (const name of ['content-type', 'anthropic-version', 'anthropic-beta', 'x-stainless-retry-count']) {
      const value = headers.get(name);
      if (value) requestHeaders[name] = cleanString(value);
    }
    notes.add('仅记录协议请求头，认证及自定义请求头不保存');
    let requestBody: unknown = null;
    let bodyAvailable = false;
    const body = init?.body;
    if (typeof body === 'string') {
      try { requestBody = sanitize(JSON.parse(body), notes); bodyAvailable = true; }
      catch { notes.add('请求体不是 JSON，未记录'); }
    } else notes.add('请求体不可读取，未记录');
    const record: TraceAttempt = current = {
      id: randomUUID(), protocol: provider.type, model, attempt: ++attempt,
      startedAt: new Date(started).toISOString(), durationMs: 0, status: 'running',
      method: init?.method ?? 'POST', url: cleanString(url.href), requestHeaders, requestBody, bodyAvailable,
      responseHeaders: {}, responseBody: null, notes: [...notes],
    };
    publish();
    try {
      const response = await globalThis.fetch(input, init);
      record.httpStatus = response.status;
      for (const name of RESPONSE_HEADERS) {
        const value = response.headers.get(name);
        if (value) record.responseHeaders[name] = cleanString(value);
      }
      record.requestId = cleanString(response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? '') || null;
      record.durationMs = Date.now() - started;
      if (!response.ok) {
        record.status = 'error';
        record.error = `HTTP ${response.status} ${cleanString(response.statusText)}`;
        // SDKs may skip a failed body (e.g. before a retry); read it here so the log still shows the reason.
        const text = await response.text();
        record.responseBody = cleanString(text.slice(0, MAX_RESPONSE_CHARS));
        record.responseBytes = Buffer.byteLength(text);
        publish();
        return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      publish();
      return observe(record, response);
    } catch (error) {
      record.durationMs = Date.now() - started;
      record.status = init?.signal?.aborted ? 'interrupted' : 'error';
      // SDK exceptions may echo the URL or headers; retain a safe category only.
      record.error = error instanceof Error ? cleanString(error.name) : 'NetworkError';
      publish();
      throw error;
    }
  };
  return {
    fetch: emit ? fetchAttempt : undefined,
    finish(result: RequestDiagnostic) {
      if (!current) return;
      current.status = result.status;
      current.durationMs = Date.now() - Date.parse(current.startedAt);
      current.rawUsage = sanitize(result.rawUsage, new Set()) as Record<string, unknown> | undefined;
      current.requestId = result.requestId ? cleanString(result.requestId) : current.requestId;
      current.responseId = result.responseId ? cleanString(result.responseId) : undefined;
      if (result.status === 'error' && !current.error) current.error = '模型响应流未正常结束';
      publish();
    },
  };
}
