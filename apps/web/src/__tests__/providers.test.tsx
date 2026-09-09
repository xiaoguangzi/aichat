import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Provider } from '@aichat/shared';
import { api } from '../api/client.js';
import { ProviderForm } from '../components/providers/ProviderForm.js';
import { ModelForm } from '../components/providers/ModelForm.js';
import { AddModels } from '../components/providers/AddModels.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const p: Provider = { id: 'p', name: 'My provider', type: 'anthropic', baseUrl: 'https://example.com', hasApiKey: true, apiKeyMasked: '****', extraHeaders: { 'X-Custom': 'keep' }, compat: { effortParam: 'reasoning_effort', thinkingDisplay: false }, createdAt: '', models: [{ id: 'm', providerId: 'p', modelId: 'existing', displayName: 'Existing', caps: { image: false, pdf: true, tools: true, thinking: true }, maxOutput: 8192, adaptive: false, reasoningMap: { off: null, max: 'high' }, isDefault: true }] };
let root: Root;
let el: HTMLDivElement;
beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.restoreAllMocks(); });
async function render(node: ReactNode) { await act(async () => { root.render(node); }); }
async function click(text: string) {
  const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`Button missing: ${text}`);
  await act(async () => button.click());
}
async function input(label: string, value: string) {
  const field = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => { el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function check(label: string) { await act(async () => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!.click()); }

describe('provider setup workflows', () => {
  it('preserves saved secret and hidden compatibility options when editing a connection', async () => {
    const update = vi.spyOn(api.providers, 'update').mockResolvedValue(p);
    const done = vi.fn();
    await render(<ProviderForm initial={p} onDone={done} />);
    expect(el.querySelector('details')?.open).toBe(false);
    await input('供应商名称', ' Renamed ');
    await submit();
    expect(update).toHaveBeenCalledWith('p', expect.objectContaining({ name: 'Renamed', apiKey: undefined, compat: p.compat, extraHeaders: p.extraHeaders }));
    expect(done).toHaveBeenCalledWith(p);
  });
  it('uses selected template defaults and reports a failed save without discarding the input', async () => {
    const create = vi.spyOn(api.providers, 'create').mockRejectedValue(new Error('Connection unavailable'));
    await render(<ProviderForm onDone={vi.fn()} />);
    await click('OpenRouter多模型聚合');
    await submit();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', compat: { thinkingFormat: 'openrouter' } }));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Connection unavailable');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="供应商名称"]')?.value).toBe('OpenRouter');
  });
  it('rejects a full completion endpoint before saving', async () => {
    const create = vi.spyOn(api.providers, 'create');
    await render(<ProviderForm onDone={vi.fn()} />);
    await input('供应商名称', 'Gateway');
    await input('API 地址', 'https://example.com/v1/chat/completions');
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('基础地址');
  });
  it('edits model capabilities without losing reasoning mappings and blocks duplicate manual additions', async () => {
    const update = vi.spyOn(api.providers, 'updateModel').mockResolvedValue(p.models[0]!);
    const add = vi.spyOn(api.providers, 'addModel');
    await render(<ModelForm p={p} m={p.models[0]} onDone={vi.fn()} onCancel={vi.fn()} />);
    await input('显示名称', 'Readable');
    await submit();
    expect(update).toHaveBeenCalledWith('p', 'm', expect.objectContaining({ displayName: 'Readable', caps: p.models[0]!.caps, adaptive: false, reasoningMap: { off: null, max: 'high' } }));
    await render(<ModelForm key="new" p={p} onDone={vi.fn()} onCancel={vi.fn()} />);
    await input('模型 ID', ' existing ');
    await submit();
    expect(add).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('已添加');
  });
  it('deduplicates remote models, protects existing models and retries only unfinished imports', async () => {
    vi.spyOn(api.providers, 'remoteModels').mockResolvedValue([{ id: 'existing' }, { id: 'first', displayName: 'First' }, { id: 'first' }, { id: 'second' }]);
    const add = vi.spyOn(api.providers, 'addModel').mockResolvedValueOnce(p.models[0]!).mockRejectedValueOnce(new Error('Rate limit')).mockResolvedValueOnce(p.models[0]!);
    const done = vi.fn();
    await render(<AddModels p={p} onDone={done} onChanged={vi.fn()} onCancel={vi.fn()} />);
    await click('获取模型列表');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="选择 existing"]')?.disabled).toBe(true);
    expect(el.querySelectorAll('input[aria-label="选择 first"]')).toHaveLength(1);
    await check('选择 first'); await check('选择 second');
    await click('添加所选（2）');
    expect(done).not.toHaveBeenCalled();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('已成功添加 1');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="选择 first"]')?.disabled).toBe(true);
    await click('添加所选（1）');
    expect(add.mock.calls.map(([, body]) => body.modelId)).toEqual(['first', 'second', 'second']);
    expect(done).toHaveBeenCalledOnce();
  });
  it('allows manual addition when remote discovery is unavailable', async () => {
    vi.spyOn(api.providers, 'remoteModels').mockRejectedValue(new Error('Not supported'));
    const add = vi.spyOn(api.providers, 'addModel').mockResolvedValue(p.models[0]!);
    const done = vi.fn();
    await render(<AddModels p={p} onDone={done} onChanged={vi.fn()} onCancel={vi.fn()} />);
    await click('获取模型列表');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('手动添加');
    await click('手动添加');
    await input('模型 ID', 'new-model');
    await submit();
    expect(add).toHaveBeenCalledWith('p', expect.objectContaining({ modelId: 'new-model', displayName: 'new-model' }));
    expect(done).toHaveBeenCalledOnce();
  });
});
