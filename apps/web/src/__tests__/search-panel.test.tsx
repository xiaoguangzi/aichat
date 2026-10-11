import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SearchHit } from '@aichat/shared';
import { SearchPanel } from '../components/chat/SearchPanel';
import { api } from '../api/client';
import { useChat } from '../store/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  messageId: 'm1', conversationId: 'c1', conversationTitle: '缓存排查', role: 'assistant',
  seq: 4, createdAt: '2026-10-01T00:00:00.000Z', snippet: '…缓存前缀被改写…', visible: true, ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useChat.setState({ select: vi.fn(async () => {}), requestJump: vi.fn(), pendingJumpId: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (onClose = () => {}) => {
  await act(async () => root.render(<SearchPanel onClose={onClose} />));
};

const type = async (value: string) => {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索消息内容"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** The panel debounces typing, so a query only runs after the timer. */
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
};

it('groups hits by conversation and shows who wrote them', async () => {
  const search = vi.spyOn(api.search, 'messages').mockResolvedValue([
    hit(),
    hit({ messageId: 'm2', role: 'user', snippet: '为什么缓存没命中' }),
  ]);
  await mount();
  await type('缓存');
  await settle();

  expect(search).toHaveBeenCalledWith({ q: '缓存' });
  expect(host.textContent).toContain('缓存排查 · 2 条');
  expect(host.textContent).toContain('为什么缓存没命中');
  expect(host.textContent).toContain('AI');
});

it('passes role and date filters to the query', async () => {
  const search = vi.spyOn(api.search, 'messages').mockResolvedValue([]);
  await mount();
  await type('缓存');
  await settle();
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '我的提问')!.click());
  await settle();
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'user' }));

  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '近 7 天')!.click());
  await settle();
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ since: expect.stringMatching(/^\d{4}-/) }));
});

it('warns about a hit that sits on a superseded version', async () => {
  vi.spyOn(api.search, 'messages').mockResolvedValue([hit({ visible: false })]);
  await mount();
  await type('缓存');
  await settle();
  // Jumping there would show the currently selected version, so the user is told first.
  expect(host.textContent).toContain('旧版本');
});

it('opens the conversation and asks the list to scroll to the hit', async () => {
  const onClose = vi.fn();
  vi.spyOn(api.search, 'messages').mockResolvedValue([hit()]);
  await mount(onClose);
  await type('缓存');
  await settle();

  await act(async () => host.querySelectorAll('button')[host.querySelectorAll('button').length - 1]!.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(useChat.getState().select).toHaveBeenCalledWith('c1');
  expect(useChat.getState().requestJump).toHaveBeenCalledWith('m1');
  expect(onClose).toHaveBeenCalled();
});

it('explains the index threshold and closes on Escape', async () => {
  const onClose = vi.fn();
  vi.spyOn(api.search, 'messages').mockResolvedValue([]);
  await mount(onClose);
  await type('xx');
  await settle();
  expect(host.textContent).toContain('少于 3 个字符');

  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(onClose).toHaveBeenCalled();
});

it('scopes to the current conversation but can be widened to all of them', async () => {
  const search = vi.spyOn(api.search, 'messages').mockResolvedValue([]);
  await act(async () => root.render(<SearchPanel onClose={() => {}} scope={{ conversationId: 'c1', title: '缓存排查' }} />));
  await type('缓存');
  await settle();
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 'c1' }));

  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '本对话')!.click());
  await settle();
  expect(search).toHaveBeenLastCalledWith(expect.not.objectContaining({ conversationId: expect.anything() }));
  expect(host.textContent).not.toContain('缓存排查 · ');
});

it('surfaces a search failure instead of an empty list', async () => {
  vi.spyOn(api.search, 'messages').mockRejectedValue(new Error('索引不可用'));
  await mount();
  await type('缓存');
  await settle();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('索引不可用');
});
