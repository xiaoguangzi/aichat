import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageList } from '../components/chat/MessageList';
import { useChat } from '../store/chat';
import type { Message } from '@aichat/shared';

vi.mock('../components/chat/MessageItem', () => ({ MessageItem: () => <div>reply</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let resize: () => void;
let height: number;

async function mount(initialHeight: number) {
  height = initialHeight;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  useChat.setState({ current: null, messages: [], streaming: null, running: false, pendingResults: {} });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<MessageList />));
  const el = host.firstElementChild as HTMLDivElement;
  let top = 0;
  Object.defineProperties(el, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: () => height },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 500)); } },
  });
  resize();
  return el;
}

async function streamUpdate() {
  await act(async () => useChat.setState({ messages: [...useChat.getState().messages] }));
  resize();
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

describe('message scroll following', () => {
  it('keeps the reading position when the reader opens the process disclosure', async () => {
    const el = await mount(1000);
    const reply: Message = {
      id: 'reply', conversationId: 'chat', seq: 1, role: 'assistant', createdAt: '',
      content: [{ type: 'thinking', thinking: 'Inspect sources' }, { type: 'text', text: 'Answer' }],
    };
    await act(async () => useChat.setState({ messages: [reply] }));
    el.dispatchEvent(new Event('scroll'));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    height = 1400;
    resize();
    expect(el.scrollTop).toBe(500);
    await streamUpdate();
    expect(el.scrollTop).toBe(500);
  });

  it('resumes for the next turn, but lets the reader pause again during that reply', async () => {
    const el = await mount(1000);
    // The first reply has finished and the reader has scrolled back through it.
    await act(async () => useChat.setState({ running: true }));
    await act(async () => useChat.setState({ running: false }));
    el.scrollTop = 100;
    el.dispatchEvent(new Event('scroll'));

    // send, regenerate and editAndResend all start a new run this way.
    await act(async () => useChat.setState({ running: true }));
    expect(el.scrollTop).toBe(500);
    height = 1200;
    await streamUpdate();
    expect(el.scrollTop).toBe(700);
    el.dispatchEvent(new Event('scroll')); // delayed programmatic event

    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    el.scrollTop = 400;
    el.dispatchEvent(new Event('scroll'));
    height = 1400;
    await streamUpdate();
    expect(el.scrollTop).toBe(400);

    // Another model step within the same tool-using turn must not reset following.
    const nextStep: Message = {
      id: 'assistant-step-2', conversationId: 'chat', seq: 2, role: 'assistant',
      content: [{ type: 'text', text: 'Continuing after a tool result' }], createdAt: '',
    };
    await act(async () => useChat.setState({ messages: [nextStep] }));
    resize();
    expect(el.scrollTop).toBe(400);

    await act(async () => useChat.setState({ running: false }));
    expect(el.scrollTop).toBe(400);
    await act(async () => useChat.setState({ running: true }));
    expect(el.scrollTop).toBe(900);
  });

  it('resumes on send after an upward gesture in a reply shorter than the viewport', async () => {
    const el = await mount(500);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }));
    await act(async () => useChat.setState({ running: true }));
    height = 700;
    resize(); // delayed layout growth, without a message render
    expect(el.scrollTop).toBe(200);
  });

  it('stays at the top during upward boundary gestures and stream updates', async () => {
    const el = await mount(550);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    for (let i = 0; i < 3; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      height += 10;
      await streamUpdate();
      expect(el.scrollTop).toBe(0);
    }
  });

  it('stops following an upward gesture even when no scroll event occurs', async () => {
    const el = await mount(500);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }));
    height = 560;
    await streamUpdate();
    expect(el.scrollTop).toBe(0);
  });

  it('follows growth and resumes when the reader scrolls down to the bottom', async () => {
    const el = await mount(1000);
    el.dispatchEvent(new Event('scroll')); // delayed programmatic event
    height = 1100;
    await streamUpdate();
    expect(el.scrollTop).toBe(600);
    el.scrollTop = 570; // upward movement inside the 80px threshold
    el.dispatchEvent(new Event('scroll'));
    height = 1120;
    await streamUpdate();
    expect(el.scrollTop).toBe(570);
    el.scrollTop = 620;
    el.dispatchEvent(new Event('scroll'));
    height = 1200;
    await streamUpdate();
    expect(el.scrollTop).toBe(700);
  });
});
