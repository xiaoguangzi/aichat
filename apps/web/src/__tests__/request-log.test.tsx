import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ApiTrace, Message } from '@aichat/shared';
import { RequestLogPanel } from '../components/chat/RequestLogPanel.js';
import { useChat } from '../store/chat';
import { api } from '../api/client.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const user = (id: string, text: string, seq: number): Message => ({ id, conversationId: 'conv', seq, role: 'user', content: [{ type: 'text', text }], createdAt: '' });
const base: ApiTrace = { id: 'trace1', conversationId: 'conv', turnId: 'turn1', messageId: 'a1', providerId: 'p', providerName: 'Local mock', purpose: 'chat', protocol: 'openai', model: 'mock', attempt: 1, startedAt: '2026-09-13T00:00:00Z', durationMs: 120, status: 'complete', method: 'POST', url: 'https://example.test/v1/chat/completions', httpStatus: 200, rawUsage: { prompt_tokens: 24400, completion_tokens: 236, prompt_tokens_details: { cached_tokens: 23400 } }, bodyAvailable: true, notes: [] };
const failed: ApiTrace = { ...base, id: 'trace2', turnId: 'turn2', messageId: 'a2', status: 'error', httpStatus: 429, error: 'HTTP 429 Too Many Requests', startedAt: '2026-09-13T00:01:00Z' };
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))!;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useChat.setState({ messages: [user('turn1', 'First question', 1), user('turn2', 'Second question', 3)], streaming: null, running: false });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('lists every request of the conversation grouped by turn, filters failures, and shows raw request and response on demand', async () => {
  const list = vi.spyOn(api.traces, 'list').mockResolvedValue([base, failed]);
  const get = vi.spyOn(api.traces, 'get').mockResolvedValue({ ...base, requestHeaders: { 'content-type': 'application/json' }, requestBody: { messages: ['real wire prompt'] }, responseHeaders: { 'content-type': 'text/event-stream' }, responseBody: 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n' });
  await act(async () => root.render(<RequestLogPanel conversationId="conv" onClose={() => {}} />));
  expect(list).toHaveBeenCalledWith('conv');
  const text = () => host.textContent ?? '';
  expect(text()).toContain('2 次请求');
  expect(text()).toContain('1 次失败');
  expect(text().indexOf('First question')).toBeLessThan(text().indexOf('Second question'));
  expect(text()).toContain('24.4k↑ 236↓ · 缓存 23.4k');
  expect(text()).toContain('HTTP 429 Too Many Requests');
  expect(get).not.toHaveBeenCalled();
  await act(async () => button('Local mock / mock').click());
  expect(get).toHaveBeenCalledWith('conv', 'trace1');
  await act(async () => button('概要').click());
  expect(text()).toContain('https://example.test/v1/chat/completions');
  await act(async () => button('请求 JSON').click());
  expect(text()).toContain('real wire prompt');
  await act(async () => button('原始响应').click());
  expect(text()).toContain('data: [DONE]');
  await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  expect(text()).not.toContain('First question');
  expect(text()).toContain('Second question');
});

it('shows the final thinking from this response without needing another user message, and refreshes on completion', async () => {
  useChat.setState({ running: true });
  const list = vi.spyOn(api.traces, 'list').mockResolvedValue([{ ...base, status: 'running' }]);
  const get = vi.spyOn(api.traces, 'get').mockResolvedValue({ ...base, status: 'running', requestHeaders: {}, requestBody: { messages: [] }, responseHeaders: {}, responseBody: null });
  await act(async () => root.render(<RequestLogPanel conversationId="conv" onClose={() => {}} />));
  await act(async () => button('Local mock / mock').click());
  expect(host.textContent).toContain('等待本次响应内容');
  const responseBody = [
    { choices: [{ index: 0, delta: { reasoning_content: '最后一段' } }] },
    { choices: [{ index: 0, delta: { reasoning_content: '思考已完成' } }] },
    { choices: [{ index: 0, delta: { content: '最终回答' }, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  list.mockResolvedValue([{ ...base, responseBytes: responseBody.length }]);
  get.mockResolvedValue({ ...base, requestHeaders: {}, requestBody: { messages: [] }, responseHeaders: {}, responseBody });
  await act(async () => useChat.setState({ running: false }));
  expect(host.querySelector('pre')?.textContent).toContain('最后一段思考已完成');
  expect(host.querySelector('pre')?.textContent).toContain('最终回答');
  await act(async () => button('请求 JSON').click());
  expect(host.querySelector('pre')?.textContent).not.toContain('最后一段');
  expect(host.textContent).toContain('这是发送前的上下文');
  await act(async () => button('原始响应').click());
  expect(host.querySelector('pre')?.textContent).toBe(responseBody);
});

it('reports history without bodies honestly and keeps polling while the run continues', async () => {
  vi.useFakeTimers();
  useChat.setState({ running: true });
  const list = vi.spyOn(api.traces, 'list').mockResolvedValue([{ ...base, status: 'running', bodyAvailable: false, notes: ['未采集请求正文'] }]);
  const get = vi.spyOn(api.traces, 'get');
  await act(async () => root.render(<RequestLogPanel conversationId="conv" onClose={() => {}} />));
  await act(async () => button('Local mock / mock').click());
  expect(host.textContent).toContain('未采集请求正文');
  expect(get).not.toHaveBeenCalled();
  list.mockResolvedValue([{ ...base, bodyAvailable: false, notes: ['未采集请求正文'] }]);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(list).toHaveBeenCalledTimes(2);
  expect(button('Local mock / mock').getAttribute('aria-pressed')).toBe('true');
  expect(button('Local mock / mock').textContent).toContain('完成');
});
