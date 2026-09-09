import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Message } from '@aichat/shared';
import { useChat } from '../store/chat.js';
import { api } from '../api/client.js';
import { ArtifactWorkspace } from '../components/artifacts/ArtifactWorkspace.js';
import { ArtifactMessage } from '../components/artifacts/ArtifactMessage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const message = (text: string): Message => ({ id: 'm', conversationId: 'c', seq: 1, createdAt: '2026-09-08', role: 'assistant', content: [{ type: 'text', text }] });
const full = '```html artifact id="timer" title="Timer"\n<h1>Hello</h1>\n```';
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useChat.setState({ messages: [], streaming: null, running: false });
  vi.spyOn(api.artifacts, 'list').mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label || b.title === label)!;

it('renders an empty draft without treating null streaming as a message', async () => {
  await act(async () => root.render(<ArtifactWorkspace><p>Draft</p></ArtifactWorkspace>));
  expect(host.textContent).toBe('Draft');
});

it('auto-opens streaming artifacts, waits for completion, and respects closing', async () => {
  await act(async () => root.render(<ArtifactWorkspace conversationId="c"><p>Chat</p></ArtifactWorkspace>));
  await act(async () => useChat.setState({ streaming: message('```html artifact id="timer"\n<h1>Hel') }));
  expect(host.querySelector('aside')).not.toBeNull();
  expect(host.querySelector('iframe')).toBeNull();
  await act(async () => useChat.setState({ streaming: message(full) }));
  expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  expect(host.querySelector('iframe')?.srcdoc).toContain('<h1>Hello</h1>');
  await act(async () => button('关闭作品').click());
  await act(async () => useChat.setState({ streaming: null, messages: [message(full)] }));
  expect(host.querySelector('aside')).toBeNull();
});

it('restores edited versions and sends the selected source when asking AI to revise', async () => {
  vi.mocked(api.artifacts.list).mockResolvedValue([{ id: 'edit', messageId: 'm', artifactId: 'timer', code: '<h1>Edited</h1>', createdAt: '2026-09-09' }]);
  const send = vi.fn().mockResolvedValue(undefined);
  useChat.setState({ messages: [message(full)], send });
  await act(async () => root.render(<ArtifactWorkspace conversationId="c"><ArtifactMessage messageId="m" block={0} text={full} live={false} /></ArtifactWorkspace>));
  await act(async () => host.querySelector('button')!.click());
  const select = host.querySelector<HTMLSelectElement>('[aria-label="作品版本"]')!;
  expect(select.options.length).toBe(2);
  await act(async () => { select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('iframe')?.srcdoc).toContain('Edited');
  const input = host.querySelector<HTMLInputElement>('[aria-label="让 AI 修改作品"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '改成蓝色');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(send).toHaveBeenCalledWith(expect.stringContaining('<h1>Edited</h1>'));
  expect(send).toHaveBeenCalledWith(expect.stringContaining('artifact id="timer"'));
});

it('does not leak an open artifact into a different conversation', async () => {
  useChat.setState({ messages: [message(full)] });
  await act(async () => root.render(<ArtifactWorkspace key="c" conversationId="c"><ArtifactMessage messageId="m" block={0} text={full} live={false} /></ArtifactWorkspace>));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('aside')).not.toBeNull();
  await act(async () => root.render(<ArtifactWorkspace key="other" conversationId="other"><p>Other conversation</p></ArtifactWorkspace>));
  expect(host.querySelector('aside')).toBeNull();
});
