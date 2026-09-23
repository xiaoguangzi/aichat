import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Block, Message, ToolResultBlock } from '@aichat/shared';
import { MessageList } from '../components/chat/MessageList.js';
import { ArtifactWorkspace } from '../components/artifacts/ArtifactWorkspace.js';
import { api } from '../api/client.js';
import { useChat } from '../store/chat.js';
import * as utils from '../lib/utils.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const message = (id: string, content: Block[], extra: Partial<Message> = {}): Message => ({
  id, conversationId: 'chat', seq: 1, role: 'assistant', content, createdAt: '2026-09-10', ...extra,
});
const thinking: Block = { type: 'thinking', thinking: 'Check the sources carefully.' };
const tool: Block = { type: 'tool_use', id: 'search', name: 'mcp__exa__web_search_exa', input: { query: 'example' } };
const result: ToolResultBlock = { type: 'tool_result', tool_use_id: 'search', content: [{ type: 'text', text: 'Search result evidence' }] };
const user = message('user', [{ type: 'text', text: 'Find an answer' }], { role: 'user' });
const step = message('step', [thinking, tool], { stopReason: 'tool_use', usage: { input: 10, output: 2, inputTotalKnown: true } });
const carrier = message('result', [result], { role: 'user' });
const answer = (text: string) => message('answer', [thinking, { type: 'text', text }]);
const disclosures = () => [...host.querySelectorAll<HTMLButtonElement>('[data-message-scroller] button[aria-expanded]')];
const toggle = () => disclosures()[0]!;
const processDetails = () => document.getElementById(toggle().getAttribute('aria-controls')!)!;
const outsideProcess = () => [...host.querySelectorAll('[data-quote-text]')]
  .filter(node => !processDetails().contains(node)).map(node => node.textContent).join('\n');
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))!;
const update = async (state: Partial<ReturnType<typeof useChat.getState>>) => {
  await act(async () => useChat.setState(state));
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useChat.setState({
    current: { id: 'chat', title: 'Test', createdAt: '', updatedAt: '', providerId: null, modelId: null, systemPrompt: '', settings: {}, groupId: null },
    messages: [], streaming: null, running: false, pendingResults: {},
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const mount = async () => { await act(async () => root.render(<MessageList />)); };

it('keeps tools collapsed during streaming and preserves a manual expansion through deltas and persistence', async () => {
  await update({ messages: [user, step, carrier], streaming: message('answer', [thinking]), running: true });
  await mount();
  expect(disclosures()).toHaveLength(1);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('mcp__exa__web_search_exa');
  expect(host.textContent).toContain(thinking.thinking);
  await update({ streaming: answer(' \n') });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await update({ streaming: answer('Here is the answer') });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('mcp__exa__web_search_exa');
  expect(host.textContent).toContain('Here is the answer');
  const id = toggle().getAttribute('aria-controls');
  await act(async () => toggle().click());
  await act(async () => button('mcp__exa__web_search_exa').click());
  expect(host.textContent).toContain('Search result evidence');
  await update({ streaming: answer('Here is the answer, with more detail.') });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('Search result evidence');
  await update({ messages: [user, step, carrier, answer('Here is the complete answer.')], streaming: null });
  await update({ running: false });
  expect(toggle().getAttribute('aria-controls')).toBe(id);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('Search result evidence');
  expect(host.querySelectorAll('button[title="Regenerate"]')).toHaveLength(1);
});

it('keeps subsequent tools and reclassified reasoning collapsed until explicitly opened', async () => {
  await update({ messages: [user], streaming: { ...answer('I will search for this.'), id: 'step' }, running: true });
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await update({ streaming: message('step', [thinking, { type: 'text', text: 'I will search for this.' }, tool]) });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await update({ pendingResults: { search: result } });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await update({ messages: [user, step, carrier], streaming: message('next', []) });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await update({ streaming: message('next', [{ type: 'text', text: 'The result is ready.' }]) });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  await update({ streaming: message('next', [thinking]) });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
});

it('restores one collapsed disclosure per historical turn and keeps whole-turn copy and usage', async () => {
  const writeText = vi.spyOn(utils, 'copyText').mockResolvedValue(true);
  const complete = { ...answer('Final answer'), usage: { input: 20, output: 3, inputTotalKnown: true } };
  await update({ messages: [user, { ...step, content: [thinking, { type: 'text', text: 'Checking sources' }, tool] }, carrier, complete] });
  await mount();
  expect(disclosures()).toHaveLength(1);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).toContain('2 次思考');
  expect(host.textContent).toContain('1 次工具调用');
  expect(host.textContent).toContain('1 段过程说明');
  expect(host.textContent).not.toContain('Checking sources');
  expect(outsideProcess()).toBe('Final answer');
  await act(async () => toggle().click());
  expect(processDetails().textContent).toContain('Checking sources');
  expect(outsideProcess()).toBe('Final answer');
  await act(async () => toggle().click());
  expect(host.textContent).toContain('30↑ 5↓');
  const copies = host.querySelectorAll<HTMLButtonElement>('button[title="Copy"]');
  expect(copies).toHaveLength(2); // user + the whole assistant reply
  await act(async () => copies[1]!.click());
  expect(writeText).toHaveBeenCalledWith('Checking sources\nFinal answer');
  await update({ messages: [...useChat.getState().messages, { ...user, id: 'user-2' }], streaming: message('next', [thinking]), running: true });
  expect(disclosures()).toHaveLength(2);
  expect(disclosures().map(b => b.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
});

it('moves streamed progress into the process when later reasoning arrives in the same message', async () => {
  const progress: Block = { type: 'text', text: 'I will check the official report.' };
  await update({ messages: [user], streaming: message('answer', [progress]), running: true });
  await mount();
  expect(disclosures()).toHaveLength(0);
  expect(host.textContent).toContain(progress.text);
  await update({ streaming: message('answer', [progress, thinking]) });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).toContain(thinking.thinking);
  expect(host.textContent).not.toContain(progress.text);
  expect(outsideProcess()).toBe('');
  const complete = message('answer', [progress, thinking, { type: 'text', text: 'Verified answer' }]);
  await update({ streaming: complete });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain(progress.text);
  expect(outsideProcess()).toBe('Verified answer');
  await update({ messages: [user, complete], streaming: null, running: false });
  expect(outsideProcess()).toBe('Verified answer');
});

it('restores progress in order across calls, including tools without reasoning and a pending next step', async () => {
  const progress = message('progress', [{ type: 'text', text: 'Searching official sources.' }]);
  const search = message('step', [tool], { stopReason: 'tool_use' });
  await update({ messages: [user, progress, search, carrier], streaming: message('next', []), running: true });
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().textContent).toContain('1 次工具调用');
  expect(toggle().textContent).not.toContain('次思考');
  await act(async () => toggle().click());
  expect(processDetails().textContent).toMatch(/Searching official sources\.[\s\S]*mcp__exa__web_search_exa/);
  expect(outsideProcess()).toBe('');
  await act(async () => toggle().click());
  await update({ streaming: message('next', [{ type: 'text', text: 'Final without thinking.' }]) });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(outsideProcess()).toBe('Final without thinking.');
  expect(host.textContent).not.toContain('Searching official sources.');
});

it.each(['interrupted', 'error', 'max_tokens'] as const)('keeps progress accessible when a turn ends with %s before an answer', async stopReason => {
  await update({ messages: [user, message('stopped', [{ type: 'text', text: 'Let me check this.' }, thinking, tool], { stopReason })] });
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle().click());
  expect(processDetails().textContent).toContain('Let me check this.');
  expect(outsideProcess()).toBe('');
  await act(async () => toggle().click());
  expect(host.textContent).toContain({ interrupted: 'Interrupted', error: 'Error (partial output)', max_tokens: 'Output hit max_tokens' }[stopReason]);
});

it('keeps failure counts and interrupted output visible when the process is collapsed', async () => {
  await update({ messages: [user, step, { ...answer('Partial answer'), stopReason: 'interrupted' }], pendingResults: { search: { ...result, is_error: true } } });
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().textContent).toContain('1 项失败');
  expect(host.textContent).toContain('Interrupted');
  await act(async () => toggle().click());
  expect(host.textContent).toContain('Failed');
  await update({ messages: [user, message('error', [thinking], { stopReason: 'error' })], pendingResults: {} });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).toContain('Error (partial output)');
});

it('renders plain replies without a process control and opens artifacts at their original block index', async () => {
  await update({ messages: [user, message('plain', [{ type: 'text', text: 'Plain answer' }])] });
  await mount();
  expect(disclosures()).toHaveLength(0);
  expect(host.textContent).toContain('Plain answer');
  const source = '```html artifact id="demo" title="Demo"\n<h1>Artifact content</h1>\n```';
  vi.spyOn(api.artifacts, 'list').mockResolvedValue([]);
  await update({ messages: [user, message('artifact', [thinking, { type: 'text', text: source }, tool, { type: 'text', text: 'The artifact is ready.' }])] });
  await act(async () => root.render(<ArtifactWorkspace conversationId="chat"><MessageList /></ArtifactWorkspace>));
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('Demo');
  await act(async () => toggle().click());
  expect(processDetails().textContent).toContain('Demo');
  expect(outsideProcess()).toBe('The artifact is ready.');
  await act(async () => button('Demo').click());
  expect(host.querySelector('iframe')?.srcdoc).toContain('<h1>Artifact content</h1>');
});

it('shows a returned Responses summary while keeping tools closed after remount', async () => {
  const summaryText = '**Checking evidence**\n\nThe source supports the answer.';
  const summary: Block = { type: 'thinking', thinking: summaryText, responsesReasoning: { id: 'rs_1', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: summaryText }] } };
  await update({ messages: [user, message('step', [summary, tool], { stopReason: 'tool_use' }), carrier, message('answer', [{ type: 'text', text: 'Final answer' }])] });
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).toContain('思考摘要');
  expect(host.textContent).toContain('The source supports the answer.');
  expect(host.textContent).not.toContain('mcp__exa__web_search_exa');
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).toContain('The source supports the answer.');
});

it('labels Anthropic thinking as a summary and compatible Chat reasoning as content', async () => {
  await update({ messages: [user, message('anthropic', [{ type: 'thinking', thinking: 'Claude summary', signature: 'opaque' }, { type: 'text', text: 'Answer' }])] });
  await mount();
  expect(host.textContent).toContain('思考摘要');
  await update({ messages: [user, message('chat', [{ type: 'thinking', thinking: 'Gateway reasoning' }, { type: 'text', text: 'Answer' }])] });
  expect(host.textContent).toContain('思考内容');
  expect(host.textContent).not.toContain('思考摘要');
});
