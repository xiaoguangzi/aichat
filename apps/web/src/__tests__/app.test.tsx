import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const providers = [
  { id: 'p1', name: 'Mock', type: 'openai', baseUrl: 'http://x', apiKeyMasked: '', hasApiKey: true, extraHeaders: {}, compat: {}, createdAt: '', models: [{ id: 'm1', providerId: 'p1', modelId: 'mock', displayName: 'Mock', caps: { image: true, pdf: true, tools: true, thinking: true }, maxOutput: null, adaptive: false, reasoningMap: null, isDefault: true }] },
];
const routes: Record<string, unknown> = {
  '/api/providers': providers,
  '/api/mcp': [],
  '/api/skills': { dir: '/skills', skills: [{ name: 'example-skill', description: 'demo', dir: '', allowedTools: [], files: [], hasScripts: false, autoApprove: false }], warnings: [] },
  '/api/groups': [{ id: 'g1', name: 'Work', sortOrder: 0, collapsed: false, createdAt: '', updatedAt: '' }],
  '/api/conversations': [
    { id: 'c1', title: 'Hello', providerId: 'p1', modelId: 'm1', groupId: null, systemPrompt: '', settings: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'c2', title: 'Grouped chat', providerId: 'p1', modelId: 'm1', groupId: 'g1', systemPrompt: '', settings: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  '/api/conversations/c1': { id: 'c1', title: 'Hello', providerId: 'p1', modelId: 'm1', systemPrompt: '', settings: {}, createdAt: '', updatedAt: '', messages: [
    { id: 'u1', conversationId: 'c1', seq: 1, role: 'user', content: [{ type: 'text', text: 'hi' }], createdAt: '' },
    { id: 'a1', conversationId: 'c1', seq: 2, role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '**hello** `x`' }, { type: 'tool_use', id: 't1', name: 'mcp__a__b', input: { q: 1 } }], usage: { input: 1, output: 2 }, stopReason: 'tool_use', createdAt: '' },
    { id: 'r1', conversationId: 'c1', seq: 3, role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }], is_error: false }], createdAt: '' },
  ] },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.split('?')[0]!;
    const body = routes[path];
    if (body === undefined) return new Response(JSON.stringify({ code: 'not_found', message: path }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0) as unknown as number;
});

async function render(path: string) {
  const errors: unknown[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => errors.push(a);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
  // let effects + fetches settle (the sidebar search debounce is 200ms)
  for (let i = 0; i < 15; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  console.error = origError;
  return { el, errors, root };
}

describe('App renders without crashing', () => {
  it('chat page (empty)', async () => {
    const { el, errors } = await render('/');
    expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual([]);
    expect(el.textContent).not.toContain('The UI crashed');
    expect(el.textContent).toContain('New chat');
    expect(el.querySelector('select')?.textContent).toContain('Mock');
    // effort picker sits in the composer (model declares thinking) with a concrete level
    const effort = [...el.querySelectorAll('select')].find((s) => s.textContent?.includes('Max'));
    expect(effort?.textContent).toContain('No thinking');
    expect((effort as HTMLSelectElement | undefined)?.value).toBe('high');
    // sidebar groups: the group header and its conversation, plus the ungrouped section
    expect(el.textContent).toContain('Work');
    expect(el.textContent).toContain('Grouped chat');
    expect(el.textContent).toContain('Ungrouped');
  });
  it('move-to-group menu opens from a conversation row', async () => {
    const { el, errors } = await render('/');
    expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual([]);
    const btn = [...el.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Move to group'));
    expect(btn).toBeTruthy();
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // the menu is portalled to document.body so the sidebar's scroll container cannot clip it
    const menu = [...document.body.querySelectorAll('div')].find((d) => d.textContent?.includes('Move to group'));
    expect(menu?.textContent).toContain('Work');
    expect(menu?.textContent).toContain('New group');
  });
  it('chat page with a conversation (thinking, markdown, tool card)', async () => {
    const { el, errors } = await render('/c/c1');
    expect(errors, JSON.stringify(errors).slice(0, 2000)).toEqual([]);
    expect(el.textContent).toContain('hello');
    const process = [...el.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(b => b.textContent?.includes('执行过程'))!;
    expect(process.textContent).toContain('执行过程');
    expect(process.getAttribute('aria-expanded')).toBe('false');
    expect(el.textContent).not.toContain('mcp__a__b');
    await act(async () => process.click());
    expect(el.textContent).toContain('mcp__a__b');
    expect(el.textContent).toContain('Thought process');
  });
  it('settings pages', async () => {
    for (const p of ['/settings/providers', '/settings/mcp', '/settings/skills']) {
      const { el, errors } = await render(p);
      expect(errors, p + JSON.stringify(errors).slice(0, 2000)).toEqual([]);
      expect(el.textContent).not.toContain('The UI crashed');
    }
  });
});
