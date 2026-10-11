import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_JEV_ROUTING, type Conversation, type Provider } from '@aichat/shared';
import { JevRoutingPage } from '../pages/JevRoutingPage.js';
import { AutoRouting } from '../components/chat/AutoRouting.js';
import { ModelPicker } from '../components/chat/ModelPicker.js';
import { ReasoningPicker } from '../components/chat/ReasoningPicker.js';
import { api } from '../api/client.js';
import { useChat } from '../store/chat.js';
import { useSettings } from '../store/settings.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const provider: Provider = { id: 'p', name: 'Test', type: 'openai', baseUrl: 'http://unused', hasApiKey: false, apiKeyMasked: '', extraHeaders: {}, compat: {}, createdAt: '', models: [
  { id: 'm', providerId: 'p', modelId: 'test', displayName: 'Thinking model', caps: { thinking: true, image: true, pdf: true, tools: true }, isDefault: true, adaptive: false, maxOutput: null, contextWindow: null, reasoningMap: { max: null } },
] };
const loadProviders = useSettings.getState().loadProviders;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  useSettings.setState({ providers: [provider], loadProviders: async () => {}, routingDefault: false, routingLoaded: false });
  useChat.setState({ current: null, messages: [], running: false, draftSettings: {}, draftModelId: 'm' });
  vi.spyOn(api.jev, 'routing').mockResolvedValue(structuredClone(DEFAULT_JEV_ROUTING));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useSettings.setState({ loadProviders }); vi.restoreAllMocks(); });
const mount = (element = <JevRoutingPage />) => act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>));
const click = (name: string) => act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!.click());
async function change(label: string, value: string) {
  await act(async () => {
    const el = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
it('saves independently rated profiles for the same model with different efforts and a fallback', async () => {
  const save = vi.spyOn(api.jev, 'saveRouting').mockImplementation(async input => input);
  await mount(); await click('添加候选项'); await click('添加候选项');
  await change('候选 1 名称', 'Fast response'); await change('候选 1 速度', '5'); await change('候选 1 effort', 'low');
  await change('候选 2 名称', 'Deep reasoning'); await change('候选 2 智能', '5'); await change('候选 2 effort', 'high');
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await click('保存路由配置');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, profiles: [
    expect.objectContaining({ modelId: 'm', reasoning: 'low', speed: 5 }),
    expect.objectContaining({ modelId: 'm', reasoning: 'high', intelligence: 5 }),
  ] }));
  const saved = save.mock.calls[0]![0];
  expect(saved.fallbackProfileId).toBe(saved.profiles[0]!.id);
  expect(useSettings.getState().providers).toEqual([provider]);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('保持原模型与 effort');
  expect(host.querySelector('[aria-label="候选 1 effort"]')?.textContent).not.toContain('max');
});
it('shows validation failures and keeps configuration editable', async () => {
  vi.spyOn(api.jev, 'saveRouting').mockRejectedValue(new Error('请选择兜底项'));
  await mount(); await click('添加候选项'); await click('保存路由配置');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('请选择兜底项');
  expect(host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false);
});
it('allows a new draft to opt out of the global default', async () => {
  vi.mocked(api.jev.routing).mockResolvedValue({ ...structuredClone(DEFAULT_JEV_ROUTING), enabled: true });
  await mount(<AutoRouting />);
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(useChat.getState().draftSettings.autoRoute).toBe(false);
  expect(host.textContent).toContain('使用手动选择');
});
it('displays persisted decisions and locks both model and effort controls after reload', async () => {
  const conv: Conversation = { id: 'c', title: '', modelId: 'm', providerId: 'p', groupId: null, systemPrompt: '', createdAt: '', updatedAt: '', settings: { autoRoute: true, reasoning: 'high' }, routing: {
    status: 'routed', profileId: 'deep', profileName: 'Deep reasoning', modelId: 'm', providerId: 'p', modelName: 'Thinking model', llmModel: 'test', reasoning: 'high', decidedAt: '', reason: 'fixed', confidence: 0.85,
  } };
  useChat.setState({ current: conv });
  await mount(<><AutoRouting /><ModelPicker /><ReasoningPicker /></>);
  expect(host.textContent).toContain('Jev 路由已固定');
  expect(host.textContent).toContain('Thinking model · high');
  expect(host.textContent).toContain('85.0%');
  for (const select of host.querySelectorAll('select')) expect(select.disabled).toBe(true);
  for (const button of host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')) expect(button.disabled).toBe(true);
  expect(host.querySelector('[role="switch"]')).toBeNull();
});
