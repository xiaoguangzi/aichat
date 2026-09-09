import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatSSEEvent } from '@aichat/shared';
import { resumeChat, streamChat } from '../api/sse.js';

function response(events: ChatSSEEvent[], crlf = false) {
  const data = events.map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join('');
  const encoded = new TextEncoder().encode(crlf ? data.replace(/\n/g, '\r\n') : data);
  return new Response(new ReadableStream({ start(controller) {
    // Exercise frames and UTF-8 characters split across arbitrary network chunks.
    for (let i = 0; i < encoded.length; i += 7) controller.enqueue(encoded.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reconnects an unfinished response with GET and never repeats the POST', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response([{ event: 'text_delta', data: { text: 'before' } }]))
    .mockResolvedValueOnce(response([{ event: 'text_delta', data: { text: '重连后 😀' } }, { event: 'done', data: {} }], true));
  vi.stubGlobal('fetch', fetcher);
  const events: ChatSSEEvent[] = [];
  const following = streamChat('a', { text: 'one question' }, (event) => events.push(event), new AbortController().signal);
  await vi.advanceTimersByTimeAsync(500);
  await following;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toEqual(['/api/conversations/a/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'one question' }) })]);
  expect(fetcher.mock.calls[1]).toEqual(['/api/conversations/a/events', expect.objectContaining({ method: 'GET', body: undefined })]);
  expect(events).toContainEqual({ event: 'text_delta', data: { text: '重连后 😀' } });
  expect(events.at(-1)?.event).toBe('done');
});

it('a reopened page only subscribes, and a completed job does not retry', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([{ event: 'done', data: {} }]));
  vi.stubGlobal('fetch', fetcher);
  await resumeChat('a', () => {}, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET');
});

it('retries a broken network connection and can cancel the retry wait', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetcher);
  const ac = new AbortController();
  const following = resumeChat('a', () => {}, ac.signal);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetcher).toHaveBeenCalledTimes(2);
  ac.abort();
  await following;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reports a deleted conversation without retrying indefinitely', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'conversation not found' }), { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const onEvent = vi.fn();
  await resumeChat('missing', onEvent, new AbortController().signal);
  expect(onEvent).toHaveBeenCalledWith({ event: 'error', data: { code: 'http', message: 'conversation not found' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
