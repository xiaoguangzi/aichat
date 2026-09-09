import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { McpServer } from '@aichat/shared';
import { WebSearchToggle, isExaServer } from '../components/chat/WebSearchToggle.js';
import { api } from '../api/client.js';
import { useSettings } from '../store/settings.js';
import { useChat } from '../store/chat.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const exa: McpServer = { id: 'exa-id', name: 'exa', transport: 'http', url: 'https://mcp.exa.ai/mcp', command: null, args: [], env: {}, headers: {}, cwd: null, enabled: true, status: 'connected', toolCount: 2, error: null, createdAt: '' };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  useSettings.setState({ mcpServers: [exa] });
  useChat.setState({ running: false, current: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => root.render(<MemoryRouter><WebSearchToggle /></MemoryRouter>));
}
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;

it('persists Exa enablement only and reflects changes from MCP settings', async () => {
  useSettings.setState({ mcpServers: [exa, { ...exa, id: 'other', name: 'filesystem', url: 'https://example.com' }] });
  const update = vi.spyOn(api.mcp, 'update').mockResolvedValue({ ...exa, enabled: false, status: 'disconnected' });
  await mount();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  await act(async () => toggle().click());
  expect(update).toHaveBeenCalledExactlyOnceWith('exa-id', { enabled: false });
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(useSettings.getState().mcpServers[1]!.enabled).toBe(true);
  await act(async () => useSettings.setState({ mcpServers: [exa] }));
  expect(toggle().getAttribute('aria-checked')).toBe('true');
});

it('keeps confirmed state on failure, allows retry, and prevents duplicate requests', async () => {
  const update = vi.spyOn(api.mcp, 'update').mockRejectedValueOnce(new Error('offline'));
  vi.spyOn(api.mcp, 'list').mockResolvedValue([exa]);
  await mount();
  await act(async () => { toggle().click(); toggle().click(); });
  expect(update).toHaveBeenCalledTimes(1);
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).toContain('切换失败');
  update.mockResolvedValueOnce({ ...exa, enabled: false, status: 'disconnected' });
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(host.textContent).not.toContain('切换失败');
});

it('distinguishes enabled from connected, and disables changes during generation', async () => {
  useSettings.setState({ mcpServers: [{ ...exa, enabled: false, status: 'disconnected' }] });
  vi.spyOn(api.mcp, 'update').mockResolvedValue({ ...exa, status: 'error', error: 'connection failed' });
  await mount();
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).toContain('Exa 未连接');
  await act(async () => useChat.setState({ running: true }));
  expect(toggle().disabled).toBe(true);
});

it('links to configuration when absent and does not match unrelated servers', async () => {
  expect(isExaServer({ ...exa, name: 'example', url: 'https://exa.ai.example.org' })).toBe(false);
  expect(isExaServer({ ...exa, name: 'search', url: 'https://mcp.exa.ai/mcp' })).toBe(true);
  expect(isExaServer({ ...exa, name: 'search', transport: 'stdio', command: 'npx', args: ['-y', 'exa-mcp-server@latest'] })).toBe(true);
  useSettings.setState({ mcpServers: [] });
  await mount();
  expect(toggle()).toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings/mcp');
});
