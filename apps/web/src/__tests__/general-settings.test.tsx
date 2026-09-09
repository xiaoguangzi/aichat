import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { GeneralSettingsPage } from '../pages/GeneralSettingsPage';
import { api } from '../api/client';
import { useSettings } from '../store/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const loadProviders = useSettings.getState().loadProviders;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  useSettings.setState({ loadProviders: async () => {}, providers: [{ id: 'p', name: 'Affordable', type: 'openai', baseUrl: 'http://x', apiKeyMasked: '', hasApiKey: false, extraHeaders: {}, compat: {}, createdAt: '', models: [{ id: 'cheap', modelId: 'cheap-model', displayName: 'Cheap title model', providerId: 'p', caps: { tools: false, thinking: false, image: false, pdf: false }, maxOutput: null, adaptive: false, reasoningMap: null, isDefault: false }] }] });
  vi.spyOn(api.settings, 'get').mockResolvedValue({ titleModelId: null });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useSettings.setState({ loadProviders, providers: [] }); vi.restoreAllMocks(); });
async function mount() { await act(async () => root.render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)); }
async function select(value: string) {
  await act(async () => { const el = host.querySelector('select')!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function save() { await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); }
it('saves a dedicated model and offers model setup without changing chat defaults', async () => {
  const update = vi.spyOn(api.settings, 'update').mockResolvedValue({ titleModelId: 'cheap' });
  await mount(); await select('cheap'); await save();
  expect(update).toHaveBeenCalledWith({ titleModelId: 'cheap' });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('已保存');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings/providers');
  expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
});
it('keeps a failed save editable and retries the chosen model', async () => {
  const update = vi.spyOn(api.settings, 'update').mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce({ titleModelId: 'cheap' });
  await mount(); await select('cheap'); await save();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('save failed');
  expect(host.querySelector('select')?.value).toBe('cheap');
  await save(); expect(update).toHaveBeenCalledTimes(2);
});
it('shows a deleted title model instead of silently choosing another one', async () => {
  vi.mocked(api.settings.get).mockResolvedValue({ titleModelId: 'deleted' });
  await mount();
  expect(host.textContent).toContain('原标题模型已删除');
  expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
});
