import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSSEEvent, Conversation, Message } from '@aichat/shared';
import { api } from '../api/client.js';
import { resumeChat, streamChat } from '../api/sse.js';

vi.mock('../api/sse.js', () => ({ streamChat: vi.fn(), resumeChat: vi.fn() }));
vi.mock('../api/client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client.js')>(),
  api: {
  conversations: { get: vi.fn(), list: vi.fn(), stop: vi.fn() },
  approvals: { resolve: vi.fn() },
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const conversation = (id: string): Conversation => ({
  id, title: id, providerId: null, modelId: null, groupId: null,
  systemPrompt: '', settings: {}, createdAt: '', updatedAt: '',
});
const message = (conversationId: string, id: string, text: string): Message => ({
  id, conversationId, seq: 1, role: 'assistant', content: [{ type: 'text', text }], createdAt: '',
});
let useChat: typeof import('../store/chat.js').useChat;
const streams = new Map<string, {
  emit: (event: ChatSSEEvent) => void;
  finish: () => void;
  signal: AbortSignal;
}>();
let sends: Promise<void>[];
let frames: Map<number, FrameRequestCallback>;

beforeEach(async () => {
  vi.resetModules();
  ({ useChat } = await import('../store/chat.js'));
  streams.clear();
  sends = [];
  frames = new Map();
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.set(++frameId, cb); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.mocked(streamChat).mockImplementation(async (id, _input, emit, signal) => {
    const done = deferred<void>();
    streams.set(id, { emit, finish: () => done.resolve(), signal });
    await done.promise;
  });
  vi.spyOn(api.conversations, 'get').mockImplementation(async (id) => ({ ...conversation(id), messages: [] }));
  vi.spyOn(api.conversations, 'list').mockResolvedValue([conversation('a'), conversation('b')]);
  vi.spyOn(api.conversations, 'stop').mockResolvedValue({ ok: true });
  useChat.setState({ current: conversation('a'), conversations: [conversation('a'), conversation('b')] });
});

afterEach(async () => {
  for (const stream of streams.values()) stream.finish();
  await Promise.all(sends);
  vi.restoreAllMocks();
});

function flush() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const cb of callbacks) cb(0);
}
function start(id: string, text = 'partial reply') {
  sends.push(useChat.getState().send(`question for ${id}`));
  const stream = streams.get(id)!;
  stream.emit({ event: 'message_start', data: { messageId: `reply-${id}`, role: 'assistant' } });
  stream.emit({ event: 'text_delta', data: { text } });
  return stream;
}

describe('stream state survives navigation', () => {
  it('attaches a freshly opened page to the server job without sending the question again', async () => {
    useChat.setState({ current: null });
    vi.mocked(api.conversations.get).mockResolvedValue({ ...conversation('a'), messages: [], running: true });
    const done = deferred<void>();
    let receive!: (event: ChatSSEEvent) => void;
    vi.mocked(resumeChat).mockImplementation(async (_id, handler) => { receive = handler; await done.promise; });
    try {
      await useChat.getState().select('a');
      expect(resumeChat).toHaveBeenCalledWith('a', expect.any(Function), expect.any(AbortSignal));
      const reply = message('a', 'reply-a', 'generated while the page was closed');
      receive({ event: 'snapshot', data: {
        conversation: conversation('a'), messages: [], streaming: reply,
        pendingResults: {}, approval: { requestId: 'pending', tool: 'script', input: {} }, running: true, error: null,
      } });
      expect(useChat.getState().streaming).toEqual(reply);
      expect(useChat.getState().approval?.requestId).toBe('pending');
      receive({ event: 'text_delta', data: { text: ' and continued' } });
      flush();
      expect(useChat.getState().streaming?.content).toEqual([{ type: 'text', text: 'generated while the page was closed and continued' }]);
      // A reconnect snapshot replaces earlier content, rather than replaying it twice.
      receive({ event: 'snapshot', data: {
        conversation: conversation('a'), messages: [reply], streaming: null,
        pendingResults: {}, approval: null, running: false, error: null,
      } });
      expect(useChat.getState().messages).toEqual([reply]);
      expect(useChat.getState().streaming).toBeNull();
      expect(useChat.getState().approval).toBeNull();
      expect(streamChat).not.toHaveBeenCalled();
    } finally {
      done.resolve();
      await done.promise;
      await Promise.resolve();
      await Promise.resolve();
    }
  });

  it('restores the partial reply immediately, even before the next animation frame or token', async () => {
    start('a');
    await useChat.getState().select('b');
    flush();
    expect(useChat.getState().streaming).toBeNull();
    expect(useChat.getState().running).toBe(false);
    await useChat.getState().select('a');
    expect(useChat.getState().streaming?.content).toEqual([{ type: 'text', text: 'partial reply' }]);
    expect(useChat.getState().running).toBe(true);
    expect(useChat.getState().messages[0]?.content).toEqual([{ type: 'text', text: 'question for a' }]);
    expect(streams.get('a')!.signal.aborted).toBe(false);
  });

  it('keeps background messages, tools and approvals out of a new draft and restores them on return', async () => {
    const stream = start('a');
    useChat.getState().newDraft();
    stream.emit({ event: 'tool_result', data: { toolUseId: 'tool-a', content: [{ type: 'text', text: 'result' }], isError: false, durationMs: 1 } });
    const saved = message('a', 'reply-a', 'saved step');
    stream.emit({ event: 'message_end', data: { messageId: saved.id, stopReason: 'tool_use', message: saved } });
    stream.emit({ event: 'approval_required', data: { requestId: 'approval-a', tool: 'script', input: {} } });
    stream.emit({ event: 'error', data: { code: 'test', message: 'error in a' } });
    flush();
    expect(useChat.getState()).toMatchObject({ messages: [], streaming: null, pendingResults: {}, approval: null, error: null, running: false, abort: null });
    await useChat.getState().select('a');
    expect(useChat.getState().messages).toContainEqual(saved);
    expect(useChat.getState().pendingResults['tool-a']).toBeDefined();
    expect(useChat.getState().approval?.requestId).toBe('approval-a');
    expect(useChat.getState().error).toBe('error in a');
  });

  it('isolates two replies and finishing one does not clear the other', async () => {
    const a = start('a', 'A');
    await useChat.getState().select('b');
    const b = start('b', 'B');
    a.emit({ event: 'text_delta', data: { text: ' continued' } });
    b.emit({ event: 'text_delta', data: { text: ' continued' } });
    flush();
    expect(useChat.getState().streaming?.content).toEqual([{ type: 'text', text: 'B continued' }]);
    a.finish();
    await sends[0];
    expect(useChat.getState().running).toBe(true);
    expect(useChat.getState().abort).not.toBeNull();
    expect(useChat.getState().streaming?.conversationId).toBe('b');
    await useChat.getState().stop();
    expect(api.conversations.stop).toHaveBeenCalledWith('b');
    expect(a.signal.aborted).toBe(false);
  });

  it('does not let a stale history response overwrite a turn that started while it was loading', async () => {
    await useChat.getState().select('b');
    const history = deferred<Conversation & { messages: Message[] }>();
    // b is cached, so it can be displayed while its history refresh is in flight.
    await useChat.getState().select('a');
    vi.mocked(api.conversations.get).mockReturnValueOnce(history.promise);
    const selecting = useChat.getState().select('b');
    start('b');
    history.resolve({ ...conversation('b'), messages: [] });
    await selecting;
    flush();
    expect(useChat.getState().streaming?.content).toEqual([{ type: 'text', text: 'partial reply' }]);
    expect(useChat.getState().messages).toHaveLength(1);
  });

  it('retains a completed background reply if the history refresh fails', async () => {
    const a = start('a');
    const saved = message('a', 'reply-a', 'completed in the background');
    await useChat.getState().select('b');
    a.emit({ event: 'message_end', data: { messageId: saved.id, stopReason: 'end_turn', message: saved } });
    vi.mocked(api.conversations.get).mockRejectedValueOnce(new Error('offline'));
    a.finish();
    await sends[0];
    expect(useChat.getState().current?.id).toBe('b');
    expect(useChat.getState().messages).toEqual([]);
    vi.mocked(api.conversations.get).mockRejectedValueOnce(new Error('still offline'));
    await expect(useChat.getState().select('a')).resolves.toBeUndefined();
    expect(useChat.getState().messages).toContainEqual(saved);
    expect(useChat.getState().running).toBe(false);
  });

  it('ignores a previous run history refresh arriving after the next send', async () => {
    const first = start('a', 'first reply');
    const oldHistory = deferred<Conversation & { messages: Message[] }>();
    vi.mocked(api.conversations.get).mockReturnValueOnce(oldHistory.promise);
    first.finish();
    await vi.waitFor(() => expect(useChat.getState().running).toBe(false));
    start('a', 'next reply');
    oldHistory.resolve({ ...conversation('a'), messages: [] });
    await sends[0];
    flush();
    expect(useChat.getState().running).toBe(true);
    expect(useChat.getState().streaming?.content).toEqual([{ type: 'text', text: 'next reply' }]);
    expect(useChat.getState().messages).toHaveLength(2);
  });
});
