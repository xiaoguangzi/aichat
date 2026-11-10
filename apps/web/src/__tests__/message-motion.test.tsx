import { afterEach, beforeEach, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Block, Message } from '@aichat/shared';
import { MessageList } from '../components/chat/MessageList.js';
import { useChat } from '../store/chat.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const message = (id: string, role: Message['role'], content: Block[]): Message => ({ id, conversationId: 'chat', seq: 1, role, content, createdAt: new Date().toISOString() });
const say = (text: string): Block[] => [{ type: 'text', text }];
const update = async (state: Partial<ReturnType<typeof useChat.getState>>) => { await act(async () => useChat.setState(state)); };
const turns = () => [...host.querySelectorAll<HTMLElement>('[data-message-scroller] > div > div')];
const waiting = () => host.querySelectorAll('.presence');

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useChat.setState({
    current: { id: 'chat', title: 'Test', createdAt: '', updatedAt: '', providerId: null, modelId: null, systemPrompt: '', settings: {}, groupId: null },
    messages: [message('q1', 'user', say('First question')), message('a1', 'assistant', say('First answer'))],
    streaming: null, running: false, pendingResults: {},
  });
  await act(async () => root.render(<MessageList />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('animates a sent message in, but neither history nor the reply that follows', async () => {
  expect(host.querySelector('.turn-enter')).toBeNull();
  const sent = message('tmp_1', 'user', say('Second question'));
  await update({ messages: [...useChat.getState().messages, sent], running: true });
  expect(turns()[2]!.className).toContain('turn-enter');

  // The optimistic message is replaced by the stored one: same node, no second entrance.
  const node = turns()[2];
  await update({ messages: [...useChat.getState().messages.slice(0, 2), { ...sent, id: 'q2' }], streaming: message('a2', 'assistant', []) });
  expect(turns()[2]).toBe(node);
  expect(host.querySelectorAll('.turn-enter')).toHaveLength(1);
  expect(turns()[3]!.className).not.toContain('turn-enter');
});

it('shows one waiting line from send until the reply has content, wherever the reply is', async () => {
  expect(waiting()).toHaveLength(0);
  await update({ messages: [...useChat.getState().messages, message('q2', 'user', say('Second question'))], running: true });
  // Before the reply exists the list holds its place.
  expect(waiting()).toHaveLength(1);
  expect(turns()).toHaveLength(4);

  await update({ streaming: message('a2', 'assistant', []) });
  expect(waiting()).toHaveLength(1);
  expect(turns()).toHaveLength(4);

  await update({ streaming: message('a2', 'assistant', say('Second answer')) });
  expect(waiting()).toHaveLength(0);
  expect(host.textContent).toContain('Second answer');

  // Between the steps of a tool loop the turn itself reports progress.
  const call: Block = { type: 'tool_use', id: 'call', name: 'search', input: {} };
  await update({ messages: [...useChat.getState().messages, message('a2', 'assistant', [call])], streaming: null });
  expect(waiting()).toHaveLength(0);
  await update({ running: false });
  expect(waiting()).toHaveLength(0);
});

it('settles the footer in only for a reply that was streamed', async () => {
  expect(host.querySelector('.footer-settle')).toBeNull();
  const question = message('q2', 'user', say('Second question'));
  await update({ messages: [...useChat.getState().messages, question], streaming: message('a2', 'assistant', say('Second')), running: true });
  await update({ messages: [...useChat.getState().messages, message('a2', 'assistant', say('Second answer'))], streaming: null, running: false });
  expect(host.querySelectorAll('.footer-settle')).toHaveLength(1);
  expect(host.querySelectorAll('button[title="Copy"]')).toHaveLength(4);
});
