import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent } from '@aichat/shared';
import { initDb, closeDb, getDb } from '../src/db/database.js';
import { modelsRepo, providersRepo } from '../src/db/repos/providers.js';
import { settingsRepo } from '../src/db/repos/settings.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { requestDiagnosticsRepo } from '../src/db/repos/requestDiagnostics.js';
import { createApp } from '../src/app.js';
import { generateTitle } from '../src/agent/title.js';
import { getAdapter } from '../src/llm/registry.js';
import type { LLMRequest } from '../src/llm/types.js';
import { requestDiagnostics } from '../src/llm/diagnostics.js';

vi.mock('../src/llm/registry.js', () => ({ getAdapter: vi.fn(), evictAdapter: vi.fn() }));
let dir: string;
let calls: LLMRequest[];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-title-'));
  initDb(path.join(dir, 'test.db'));
  calls = [];
  vi.mocked(getAdapter).mockImplementation(() => ({ type: 'openai', listModels: async () => [], async *stream(req): AsyncIterable<StreamEvent> { calls.push(req); yield { type: 'text_delta', text: '"简短标题"' }; yield { type: 'done', stopReason: 'end_turn' }; } }));
});
afterEach(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });
function fixtures() {
  const chatProvider = providersRepo.create({ name: 'chat', type: 'openai', baseUrl: 'https://chat.example', apiKey: 'chat-secret' });
  const titleProvider = providersRepo.create({ name: 'titles', type: 'anthropic', baseUrl: 'https://title.example', apiKey: 'title-secret' });
  const chat = modelsRepo.upsert(chatProvider.id, { modelId: 'chat-model' });
  const title = modelsRepo.upsert(titleProvider.id, { modelId: 'cheap-title', caps: { thinking: true }, reasoningMap: { off: null } });
  const conv = conversationsRepo.create({ modelId: chat.id });
  return { conv, chat, title, titleProvider };
}
describe('title model selection', () => {
  it('persists a separate model, uses its provider and limits context/reasoning without tools', async () => {
    const { conv, title, titleProvider } = fixtures();
    const app = createApp();
    const saved = await app.request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titleModelId: title.id }) });
    expect(saved.status).toBe(200);
    expect(await (await app.request('/api/settings')).json()).toEqual({ titleModelId: title.id });
    expect(await generateTitle(conv, 'a'.repeat(4000), 'b'.repeat(4000))).toBe('简短标题');
    expect(getAdapter).toHaveBeenCalledWith(expect.objectContaining({ id: titleProvider.id, apiKey: 'title-secret' }));
    expect(calls[0]).toMatchObject({ model: 'cheap-title', reasoning: 'minimal', maxTokens: 512 });
    expect(calls[0]!.tools).toBeUndefined();
    expect(JSON.stringify(calls[0]!.messages).length).toBeLessThan(1500);
  });
  it('defaults to the chat model and allows clearing the selection', async () => {
    const { conv, title } = fixtures();
    expect(await generateTitle(conv, 'hello', 'answer')).toBe('简短标题');
    expect(calls[0]!.model).toBe('chat-model');
    settingsRepo.set('title.modelId', title.id);
    const result = await createApp().request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"titleModelId":null}' });
    expect(result.status).toBe(200);
    expect(settingsRepo.get('title.modelId', 'missing')).toBeNull();
  });
  it('rejects nonexistent model IDs and avoids an expensive fallback after model deletion', async () => {
    const { conv, title } = fixtures();
    const result = await createApp().request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"titleModelId":"missing"}' });
    expect(result.status).toBe(400);
    settingsRepo.set('title.modelId', title.id);
    modelsRepo.delete(title.id);
    expect(await generateTitle(conv, 'hello', 'answer')).toBeNull();
    expect(getAdapter).not.toHaveBeenCalled();
  });
  it('returns the local fallback signal when title generation fails', async () => {
    const { conv } = fixtures();
    vi.mocked(getAdapter).mockImplementation(() => { throw new Error('unavailable'); });
    expect(await generateTitle(conv, 'hello', 'answer')).toBeNull();
  });
});

it('bounds diagnostic storage and removes it with its conversation', () => {
  const { conv } = fixtures();
  const record = requestDiagnostics('openai', { model: 'm', messages: [] }, data => requestDiagnosticsRepo.save(conv.id, 'message', 'provider', data));
  for (let i = 0; i < 503; i++) record({ status: 'complete', rawUsage: { prompt_tokens: i } });
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM request_diagnostics').get()).toMatchObject({ n: 500 });
  getDb().prepare('DELETE FROM conversations WHERE id=?').run(conv.id);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM request_diagnostics').get()).toMatchObject({ n: 0 });
});
