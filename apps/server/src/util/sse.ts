import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatSSEEvent } from '@aichat/shared';
import { type BackgroundRun, idleSnapshot } from '../agent/runs.js';

/** Subscribe to a job. Closing this connection only removes the subscriber. */
export function streamRun(c: Context, id: string, run?: BackgroundRun) {
  return streamSSE(c, async (stream) => {
    let closed = false;
    let wake = () => {};
    let queue: Array<ChatSSEEvent | null> = [];
    const snapshot = (): ChatSSEEvent => ({ event: 'snapshot', data: run?.snapshot() ?? idleSnapshot(id) });
    const enqueue = (event: ChatSSEEvent | null) => {
      if (closed) return;
      // A slow tab must not accumulate an unbounded token replay log.
      if (queue.length >= 256) queue = [snapshot()];
      else queue.push(event);
      if (event?.event === 'done' && queue.at(-1)?.event !== 'done') queue.push(event);
      wake();
    };
    const unsubscribe = run?.subscribe(enqueue);
    const first = snapshot();
    queue.push(first);
    if (first.event === 'snapshot' && !first.data.running) queue.push({ event: 'done', data: {} });
    const ping = setInterval(() => enqueue(null), 15_000);
    const close = () => {
      closed = true;
      unsubscribe?.();
      clearInterval(ping);
      queue = [];
      wake();
    };
    stream.onAbort(close);
    try {
      while (!closed) {
        if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; });
        if (closed) break;
        const event = queue.shift();
        if (event) {
          await stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) });
          if (event.event === 'done') break;
        } else await stream.write(': ping\n\n');
      }
    } finally {
      close();
    }
  });
}
