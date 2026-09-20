import { jevResponseSchema, type JevRequest, type JevResult } from '@aichat/shared';
import { AppError } from '../util/errors.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

function redact(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return value.split(secret).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(item => redact(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.split(secret).join('[REDACTED]'), redact(item, secret)]));
  return value;
}

/** Single non-streaming decision request; never enters the LLM/tool/title loop. */
export async function evaluateJev(input: JevRequest, apiKey: string, signal?: AbortSignal): Promise<JevResult> {
  const start = performance.now();
  const timeout = AbortSignal.timeout(60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(JEV_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(input),
    });
    // Bound response memory, including upstream error pages.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new AppError('jev_response', 'Jev 响应超过 2 MiB 限制', 502);
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    // Decode before redaction so JSON-escaped credential echoes are covered too.
    const raw = Buffer.concat(chunks).toString('utf8');
    let json: unknown;
    try { json = redact(JSON.parse(raw), apiKey); } catch { /* handled below */ }
    if (!res.ok) {
      let detail = '';
      if (json && typeof json === 'object') {
        const data = json as { error?: { message?: unknown }; message?: unknown; detail?: unknown };
        const message = data?.error?.message ?? data?.message ?? data?.detail;
        if (typeof message === 'string') detail = `：${message.slice(0, 500)}`;
      }
      throw new AppError('jev_upstream', `Jev 请求失败（HTTP ${res.status}）${detail}`, res.status >= 400 && res.status < 500 ? res.status : 502);
    }
    if (json === undefined) throw new AppError('jev_response', 'Jev 返回了无效 JSON', 502);
    const parsed = jevResponseSchema.safeParse(json);
    if (!parsed.success) throw new AppError('jev_response', 'Jev 返回的数据不符合决策响应格式', 502);
    const response = parsed.data;
    if (Object.keys(response.answers).length !== Object.keys(input.questions).length ||
      Object.entries(input.questions).some(([id, question]) => response.answers[id]?.type !== question.type)) {
      throw new AppError('jev_response', 'Jev 返回的问题与请求不匹配', 502);
    }
    return { response, elapsedMs: Math.round(performance.now() - start) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (timeout.aborted) throw new AppError('jev_timeout', 'Jev 请求超时（60 秒），请重试', 504);
    if (signal?.aborted) throw new AppError('aborted', 'Jev 请求已取消', 499);
    throw new AppError('jev_network', '无法连接 TypeSafe API，请检查网络后重试', 502);
  }
}
