import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Message } from '@aichat/shared';
import { MessageList } from '../components/chat/MessageList';
import { useChat } from '../store/chat';

vi.mock('../components/chat/MessageItem', () => ({ MessageItem: () => <div>message</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
const message = (id: string, content: Message['content'], role: Message['role'] = 'user'): Message => ({ id, conversationId: 'chat', seq: 1, createdAt: '', role, content });
const question = (id: string) => message(id, [{ type: 'text', text: `Question ${id}` }]);
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="提问导航"]')!;
const entries = () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label^="跳转到第"]')];
const flushFrames = async () => { await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0)); }); };

beforeEach(() => {
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  useChat.setState({ current: null, messages: [], streaming: null, running: false, pendingResults: {} });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async (messages: Message[]) => { useChat.setState({ messages }); await act(async () => root.render(<MessageList />)); };

it('lists actual questions and attachment-only messages, excluding tool result carriers', async () => {
  await mount([
    question('one'),
    message('reply', [{ type: 'text', text: 'Reply' }], 'assistant'),
    message('result', [{ type: 'tool_result', tool_use_id: 'tool', content: [] }]),
    message('image', [{ type: 'image', mime: 'image/png' }]),
    message('file', [{ type: 'document', mime: 'text/plain', name: 'notes.txt' }]),
    message('multi', [{ type: 'text', text: 'First\nline' }, { type: 'text', text: 'Second line' }]),
  ]);
  await act(async () => trigger().click());
  expect(entries().map(entry => entry.textContent)).toEqual(['Question one', '图片消息', 'notes.txt', 'First line Second line']);
});

it('tracks the question above the viewport and the final short turn at the bottom', async () => {
  await mount([question('one'), question('two'), question('three')]);
  const scroller = host.querySelector<HTMLElement>('[data-message-scroller]')!;
  Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
  const anchors = [...host.querySelectorAll<HTMLElement>('[data-user-message-id]')];
  anchors.forEach((anchor, index) => { anchor.getBoundingClientRect = () => ({ top: index * 600 - scroller.scrollTop }) as DOMRect; });
  await act(async () => trigger().click());
  scroller.scrollTop = 700;
  scroller.dispatchEvent(new Event('scroll'));
  await flushFrames();
  expect(entries()[1]!.getAttribute('aria-current')).toBe('location');
  scroller.scrollTop = 1500;
  scroller.dispatchEvent(new Event('scroll'));
  await flushFrames();
  expect(entries()[2]!.getAttribute('aria-current')).toBe('location');
});

it('mounts deferred history synchronously when its question is selected', async () => {
  vi.useFakeTimers();
  try {
    await mount(Array.from({ length: 30 }, (_, index) => question(String(index))));
    expect(host.querySelector('[data-user-message-id="0"]')).toBeNull();
    let jumpedId: string | undefined;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: function(this: HTMLElement) { jumpedId = this.dataset.userMessageId; } });
    await act(async () => trigger().click());
    await act(async () => entries()[0]!.click());
    expect(jumpedId).toBe('0');
    expect(host.querySelector('[data-user-message-id="0"]')).not.toBeNull();
  } finally { vi.useRealTimers(); delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView; }
});

it('closes with Escape and removes obsolete entries when history changes', async () => {
  await mount([question('one'), question('two')]);
  await act(async () => trigger().click());
  await act(async () => entries()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
  await act(async () => useChat.setState({ messages: [question('one')] }));
  await act(async () => trigger().click());
  expect(entries()).toHaveLength(1);
  await act(async () => useChat.setState({ messages: [] }));
  expect(host.querySelector('[aria-label="会话导航"]')).toBeNull();
});

it('keeps the panel open when a pointer click follows hover', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  await mount([question('one')]);
  await act(async () => trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  await act(async () => trigger().click());
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(entries()).toHaveLength(1);
});
