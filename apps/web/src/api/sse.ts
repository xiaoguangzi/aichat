import type { ChatSSEEvent, SendMessageInput } from '@aichat/shared';

async function readEvents(res: Response, onEvent: (event: ChatSSEEvent) => void): Promise<boolean> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  const dispatch = (chunk: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data.join('\n')); } catch { return; }
    onEvent({ event, data: parsed } as ChatSSEEvent);
    if (event === 'done') complete = true;
  };
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        dispatch(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) { if (buffer.trim()) dispatch(buffer); break; }
    }
    return complete;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function followChat(conversationId: string, input: SendMessageInput | undefined, onEvent: (event: ChatSSEEvent) => void, signal: AbortSignal) {
  let initial = input;
  let delay = 500;
  while (!signal.aborted) {
    const posting = initial !== undefined;
    const body = initial;
    // A reconnect always subscribes; it must never resubmit the user's message.
    initial = undefined;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/${posting ? 'messages' : 'events'}`, {
        method: posting ? 'POST' : 'GET',
        headers: { ...(posting ? { 'Content-Type': 'application/json' } : {}), Accept: 'text/event-stream' },
        body: posting ? JSON.stringify(body) : undefined, signal,
      });
      if (!res.ok || !res.body) {
        let message = res.statusText;
        try { message = ((await res.json()) as { message?: string }).message ?? message; } catch { /* no JSON body */ }
        if (res.status >= 400 && res.status < 500) {
          onEvent({ event: 'error', data: { code: 'http', message } });
          return;
        }
        throw new Error(message || 'Stream unavailable');
      }
      delay = 500;
      if (await readEvents(res, onEvent)) return;
    } catch (e) {
      if (signal.aborted) return;
      onEvent({ event: 'error', data: { code: 'network', message: `连接已断开，正在恢复回复：${e instanceof Error ? e.message : String(e)}` } });
    }
    await retryDelay(delay, signal);
    delay = Math.min(delay * 2, 10_000);
  }
}

/** Start a job once and follow it through transient connection loss. */
export function streamChat(conversationId: string, input: SendMessageInput, onEvent: (event: ChatSSEEvent) => void, signal: AbortSignal): Promise<void> {
  return followChat(conversationId, input, onEvent, signal);
}

/** Attach a freshly opened page to an existing backend job. */
export function resumeChat(conversationId: string, onEvent: (event: ChatSSEEvent) => void, signal: AbortSignal): Promise<void> {
  return followChat(conversationId, undefined, onEvent, signal);
}
