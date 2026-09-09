import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ChatSSEEvent, Conversation, Message } from '@aichat/shared';
import App from '../App.js';
import { useChat } from '../store/chat.js';
import { streamChat } from '../api/sse.js';

vi.mock('../api/sse.js', () => ({ streamChat: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conv: Conversation = {
  id: 'settings-stream', title: 'Navigation test', providerId: null, modelId: null,
  groupId: null, systemPrompt: '', settings: {}, createdAt: '', updatedAt: '',
};
let saved: Message[];
let root: Root;
let host: HTMLDivElement;
let emit: (event: ChatSSEEvent) => void;
let finish: () => void;
let sending: Promise<void> | undefined;

beforeEach(() => {
  saved = [];
  sending = undefined;
  useChat.setState({ current: conv, conversations: [conv], messages: [], streaming: null, running: false, pendingResults: {}, approval: null, error: null, abort: null });
  vi.mocked(streamChat).mockImplementation(async (_id, _input, handler) => {
    emit = handler;
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = input.split('?')[0]!;
    const routes: Record<string, unknown> = {
      '/api/providers': [], '/api/settings': {}, '/api/mcp': [], '/api/groups': [],
      '/api/skills': { dir: '', skills: [], warnings: [] },
      '/api/conversations': [conv],
      [`/api/conversations/${conv.id}`]: { ...conv, messages: saved },
      [`/api/conversations/${conv.id}/artifacts`]: [],
    };
    if (!(url in routes)) throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(routes[url]), { headers: { 'content-type': 'application/json' } });
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { if (sending) { finish(); await sending; } root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

async function click(link: HTMLAnchorElement) {
  await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}

it.each([false, true])('keeps the reply through Settings and Back to chat (finishes offscreen: %s)', async (complete) => {
  await act(async () => {
    root.render(<React.StrictMode><MemoryRouter initialEntries={[`/c/${conv.id}`]}><App /></MemoryRouter></React.StrictMode>);
  });
  await act(async () => {
    sending = useChat.getState().send('Keep this question');
    emit({ event: 'message_start', data: { messageId: 'reply', role: 'assistant' } });
    emit({ event: 'text_delta', data: { text: 'The reply is still here' } });
  });
  await click(host.querySelector<HTMLAnchorElement>('a[title="Settings"]')!);
  expect(host.textContent).toContain('Back to chat');
  if (complete) {
    saved = [
      { ...useChat.getState().messages[0]!, id: 'user', seq: 1 },
      { id: 'reply', conversationId: conv.id, seq: 2, role: 'assistant', content: [{ type: 'text', text: 'The reply is still here' }], createdAt: '' },
    ];
    await act(async () => {
      emit({ event: 'message_end', data: { messageId: 'reply', stopReason: 'end_turn', message: saved[1]! } });
      finish();
      await sending;
    });
  }
  const back = [...host.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.includes('Back to chat'))!;
  expect(back.getAttribute('href')).toBe(`/c/${conv.id}`);
  await click(back);
  // No additional stream token is needed to restore the reply after remounting.
  expect(host.textContent).toContain('Keep this question');
  expect(host.textContent).toContain('The reply is still here');
  expect(useChat.getState().running).toBe(!complete);
});
