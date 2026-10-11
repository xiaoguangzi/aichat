import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Message } from '@aichat/shared';
import { MessageList } from '../components/chat/MessageList';
import { useChat } from '../store/chat';
import { api } from '../api/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const message = (over: Partial<Message> & { id: string; seq: number; role: Message['role'] }): Message => ({
  conversationId: 'c1', content: [{ type: 'text', text: `text-${over.id}` }], createdAt: '', ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (messages: Message[]) => {
  useChat.setState({ current: { id: 'c1' } as never, messages, running: false, streaming: null });
  await act(async () => root.render(<MessageList />));
};

const counter = () => host.querySelector('[title^="这是该位置的"]')?.textContent;

it('offers ‹ n/m › only where the server reported sibling variants', async () => {
  await mount([
    message({ id: 'u1', seq: 1, role: 'user', variants: { index: 2, total: 2, siblingIds: ['u0', 'u1'] } }),
    message({ id: 'a1', seq: 2, role: 'assistant' }),
  ]);
  // One switcher on the question that has a sibling; nothing on the single answer.
  expect(host.querySelectorAll('[title^="这是该位置的"]')).toHaveLength(1);
  expect(counter()).toBe('2/2');
});

it('switches to the sibling and repaints the conversation it returns', async () => {
  const branch = vi.spyOn(api.conversations, 'branch').mockResolvedValue({
    id: 'c1', title: 't', providerId: null, modelId: null, groupId: null, systemPrompt: '', settings: {},
    createdAt: '', updatedAt: '', messages: [
      message({ id: 'a0', seq: 1, role: 'assistant', content: [{ type: 'text', text: 'older answer' }], variants: { index: 1, total: 2, siblingIds: ['a0', 'a1'] } }),
    ],
  } as never);
  await mount([
    message({ id: 'u1', seq: 1, role: 'user' }),
    message({ id: 'a1', seq: 2, role: 'assistant', content: [{ type: 'text', text: 'newer answer' }], variants: { index: 2, total: 2, siblingIds: ['a0', 'a1'] } }),
  ]);
  expect(host.textContent).toContain('newer answer');

  const prev = host.querySelector<HTMLButtonElement>('[aria-label="上一个版本"]')!;
  await act(async () => {
    prev.click();
    await new Promise((r) => setTimeout(r, 0));
  });
  // The control wraps around, so "previous" from 2/2 means the first sibling.
  expect(branch).toHaveBeenCalledWith('c1', 'a0');
  expect(host.textContent).toContain('older answer');
  expect(host.textContent).not.toContain('newer answer');
});

it('hides the control while a reply is streaming', async () => {
  useChat.setState({
    current: { id: 'c1' } as never,
    messages: [message({ id: 'a1', seq: 1, role: 'assistant', variants: { index: 1, total: 2, siblingIds: ['a1', 'a2'] } })],
    running: true,
    streaming: null,
  });
  await act(async () => root.render(<MessageList />));
  const next = host.querySelector<HTMLButtonElement>('[aria-label="下一个版本"]');
  // The counter still shows the position, but switching mid-run would fight the stream.
  expect(counter()).toBe('1/2');
  expect(next?.disabled).toBe(true);
});
