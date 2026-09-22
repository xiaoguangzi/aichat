import { setTimeout } from 'node:timers/promises';
import type { StreamEvent } from '@aichat/shared';
import { AppError } from '../util/errors.js';

function isThinkingRejection(error: unknown): boolean {
  if (!(error instanceof AppError) || error.code !== 'bad_request' || error.status !== 400) return false;
  // Match a parameter rejection, not unrelated thinking/signature/budget validation errors.
  const patterns = [
    /\bthinking["']?(?:\s+(?:parameter|mode|field))?\s*:?\s*(?:is\s+)?(?:not supported|unsupported)\b/i,
    /\b(?:unsupported|does not support|not support(?:ed)?)(?:\s+(?:the|parameter|field|mode))*\s*:?\s*["']?thinking\b(?!\.\w)/i,
    /thinking["']?(?:参数|模式)?不支持|不支持(?:参数|模式)?[：:\s"']*thinking\b/i,
  ];
  return patterns.some(pattern => pattern.test(error.message));
}

/** One unchanged retry for XAIO's intermittent thinking-parameter rejection. */
export async function* retryXaioThinking(
  baseUrl: string,
  signal: AbortSignal | undefined,
  attempt: () => AsyncIterable<StreamEvent>,
): AsyncIterable<StreamEvent> {
  let xaio = false;
  try { xaio = new URL(baseUrl).hostname === 'llm-api.x-aio.com'; } catch { /* Keep normal adapter errors. */ }
  let emitted = false;
  for (let index = 0; ; index++) {
    try {
      signal?.throwIfAborted();
      for await (const event of attempt()) {
        emitted = true;
        yield event;
      }
      return;
    } catch (error) {
      if (!xaio || index !== 0 || emitted || signal?.aborted || !isThinkingRejection(error)) throw error;
      // Keep the selected model, effort and request body; do not silently disable thinking.
      await setTimeout(250, undefined, { signal });
    }
  }
}
