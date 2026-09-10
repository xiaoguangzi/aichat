import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Provider } from '@aichat/shared';
import { ModelPicker } from '../components/chat/ModelPicker.js';
import { Composer } from '../components/chat/Composer.js';
import { useSettings } from '../store/settings.js';
import { useChat } from '../store/chat.js';
import { api } from '../api/client.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const provider: Provider = {
  id: 'p', name: 'Provider', type: 'openai', baseUrl: 'http://localhost',
  hasApiKey: false, apiKeyMasked: '', extraHeaders: {}, compat: {}, createdAt: '',
  models: [{ id: 'first', providerId: 'p', modelId: 'first', displayName: 'First model',
    caps: { image: false, pdf: false, tools: true, thinking: true },
    maxOutput: null, adaptive: false, reasoningMap: null, isDefault: false }],
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  useSettings.setState({ providers: [], mcpServers: [], skills: [] });
  useChat.setState({ current: null, draftModelId: null, draftReasoning: 'high', running: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const effort = () => host.querySelector<HTMLButtonElement>('button[title^="Thinking effort"]');
async function mount() {
  await act(async () => root.render(<MemoryRouter><ModelPicker /><Composer /></MemoryRouter>));
}

it('shows effort and enables composing after models load without a default or a model click', async () => {
  await mount();
  expect(effort()).toBeNull();
  await act(async () => useSettings.setState({ providers: [provider] }));
  expect(effort()?.textContent).toContain('High');
  expect(host.querySelector('textarea')?.placeholder).toContain('输入你的问题');
  expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).not.toContain('image/*');
  expect(host.querySelector('select')?.value).toBe('first');
  const create = vi.spyOn(api.conversations, 'create').mockResolvedValue({
    id: 'created', title: '', modelId: 'first', providerId: 'p', groupId: null,
    systemPrompt: '', settings: { reasoning: 'high' }, createdAt: '', updatedAt: '',
  });
  await act(async () => { await useChat.getState().createConversation(); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'first' }));
});

it('prefers the default and then an explicit selection, including after starting a new draft', async () => {
  const defaultModel = { ...provider.models[0]!, id: 'default', displayName: 'Default model', isDefault: true, caps: { ...provider.models[0]!.caps, thinking: false } };
  useSettings.setState({ providers: [{ ...provider, models: [...provider.models, defaultModel] }] });
  await mount();
  expect(host.querySelector('select')?.value).toBe('default');
  expect(effort()).toBeNull();
  await act(async () => useChat.getState().setDraftModelId('first'));
  expect(effort()?.textContent).toContain('High');
  await act(async () => useChat.getState().newDraft());
  expect(host.querySelector('select')?.value).toBe('default');
  expect(effort()).toBeNull();
});
