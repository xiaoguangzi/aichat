import { afterEach, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@aichat/shared';
import { AnthropicAdapter } from '../src/llm/anthropic/adapter.js';
import { OpenAIAdapter } from '../src/llm/openai/adapter.js';
import { retryXaioThinking } from '../src/llm/xaio-retry.js';
import type { TraceAttempt } from '../src/llm/trace.js';
import { AppError } from '../src/util/errors.js';

const provider = { id: 'p', name: 'any display name', baseUrl: 'https://llm-api.x-aio.com', apiKey: 'test-secret', extraHeaders: {}, compat: { thinkingFormat: 'zai' as const }, createdAt: '' };
const req = { model: 'configured-model', reasoning: 'high' as const, adaptive: false, maxTokens: 200, messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }] };
const rejected = (message = 'This model does not support thinking') => Response.json({ error: { type: 'invalid_request_error', message } }, { status: 400 });
const consume = async (stream: AsyncIterable<StreamEvent>) => { const out: StreamEvent[] = []; for await (const e of stream) out.push(e); return out; };
function success(protocol: string) {
  const events = protocol === 'openai'
    ? ['data: {"id":"answer","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}', 'data: [DONE]']
    : [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"answer","type":"message","role":"assistant","model":"configured-model","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":5,"output_tokens":0}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ];
  return new Response(events.join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['anthropic', 'openai'] as const)('retries an unchanged %s request once and preserves separate traces', async type => {
  const snapshots: TraceAttempt[] = [];
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(init.body);
    return bodies.length === 1 ? rejected() : success(type);
  }));
  const adapter = type === 'anthropic' ? new AnthropicAdapter({ ...provider, type }) : new OpenAIAdapter({ ...provider, type });
  const out = await consume(adapter.stream({ ...req, onTrace: r => snapshots.push(r) }));
  expect(out.filter(e => e.type === 'text_delta')).toEqual([{ type: 'text_delta', text: 'hello' }]);
  expect(out.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' });
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[1]!)).toMatchObject({ model: req.model, thinking: { type: 'enabled' } });
  const traces = [...new Map(snapshots.map(r => [r.id, r])).values()];
  expect(traces).toHaveLength(2);
  expect(traces[0]).toMatchObject({ attempt: 1, httpStatus: 400, status: 'error' });
  expect(traces[0]!.responseBody).toContain('does not support thinking');
  expect(traces[1]).toMatchObject({ attempt: 2, httpStatus: 200, status: 'complete' });
});

it('stops after the second rejection without an onTrace callback', async () => {
  const fetcher = vi.fn(async () => rejected()); vi.stubGlobal('fetch', fetcher);
  await expect(consume(new AnthropicAdapter({ ...provider, type: 'anthropic' }).stream(req))).rejects.toMatchObject({ status: 400 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  ['https://api.anthropic.com', 'This model does not support thinking', 400],
  ['https://llm-api.x-aio.com.example.test', 'thinking is not supported', 400],
  [provider.baseUrl, 'Invalid thinking signature', 400],
  [provider.baseUrl, 'thinking budget_tokens must be less than max_tokens', 400],
  [provider.baseUrl, 'thinking.display is not supported', 400],
  [provider.baseUrl, 'unsupported parameter: thinking.signature', 400],
  [provider.baseUrl, 'max_tokens is not supported', 400],
  [provider.baseUrl, 'thinking is not supported', 401],
])('does not broaden retries: %s / %s / %s', async (url, message, status) => {
  const attempt = vi.fn(async function* (): AsyncIterable<StreamEvent> { throw new AppError('bad_request', message, status); });
  await expect(consume(retryXaioThinking(url, undefined, attempt))).rejects.toThrow(message);
  expect(attempt).toHaveBeenCalledTimes(1);
});

it.each(['thinking is not supported', 'Unsupported parameter: thinking', 'This model does not support thinking.', '不支持参数：thinking'])('recognizes parameter rejection: %s', async message => {
  const attempt = vi.fn(async function* (): AsyncIterable<StreamEvent> { throw new AppError('bad_request', message, 400); });
  await expect(consume(retryXaioThinking(provider.baseUrl, undefined, attempt))).rejects.toThrow(message);
  expect(attempt).toHaveBeenCalledTimes(2);
});

it('never replays after output has started', async () => {
  const attempt = vi.fn(async function* (): AsyncIterable<StreamEvent> {
    yield { type: 'text_delta', text: 'partial answer' };
    throw new AppError('bad_request', 'thinking is not supported', 400);
  });
  await expect(consume(retryXaioThinking(provider.baseUrl, undefined, attempt))).rejects.toThrow();
  expect(attempt).toHaveBeenCalledTimes(1);
});

it('honors cancellation during the retry delay', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const attempt = vi.fn(async function* (): AsyncIterable<StreamEvent> { throw new AppError('bad_request', 'thinking is not supported', 400); });
  const result = expect(consume(retryXaioThinking(provider.baseUrl, abort.signal, attempt))).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(0);
  abort.abort();
  await result;
  expect(attempt).toHaveBeenCalledTimes(1);
});
