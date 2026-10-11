import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_JEV_ROUTING, type Conversation, type JevResult, type JevRoutingSettings, type Model, type StreamEvent } from '@aichat/shared';
import type { LLMRequest } from '../src/llm/types.js';
import { initDb, closeDb } from '../src/db/database.js';
import { providersRepo, modelsRepo } from '../src/db/repos/providers.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { messagesRepo } from '../src/db/repos/messages.js';
import { settingsRepo } from '../src/db/repos/settings.js';
import { createApp } from '../src/app.js';
import { evaluateJev } from '../src/decisions/jev.js';
import { routeConversation } from '../src/decisions/routing.js';
import { activeRuns, stopAllRuns } from '../src/agent/runs.js';

const calls: LLMRequest[] = [];
vi.mock('../src/decisions/jev.js', () => ({ evaluateJev: vi.fn() }));
vi.mock('../src/agent/title.js', () => ({ generateTitle: async () => null }));
vi.mock('../src/llm/registry.js', () => ({ evictAdapter: () => {}, getAdapter: () => ({
  type: 'openai', listModels: async () => [], async *stream(req: LLMRequest): AsyncIterable<StreamEvent> {
    calls.push({ ...req, messages: structuredClone(req.messages) }); yield { type: 'text_delta', text: 'routed answer' }; yield { type: 'done', stopReason: 'end_turn' };
  },
}) }));
vi.mock('../src/mcp/manager.js', () => ({ mcpManager: { toolDefs: () => [] } }));
vi.mock('../src/skills/tools.js', () => ({ skillToolDefs: () => [] }));
vi.mock('../src/skills/registry.js', () => ({ skillRegistry: { indexText: () => '', get: () => null } }));
let dir: string;
let fast: Model;
let smart: Model;
let settings: JevRoutingSettings;
const decision = (choice = 'option_1', confidence = 0.9): JevResult => ({ elapsedMs: 15, response: { model: 'jev-1.13.0', answers: { route: { type: 'choice', choice, confidence, probabilities: { option_0: 0.1, option_1: 0.9 } } } } });
beforeEach(() => {
  calls.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-routing-'));
  initDb(path.join(dir, 'test.db'));
  const provider = providersRepo.create({ name: 'test', type: 'openai', baseUrl: 'http://unused', apiKey: 'llm-test-key' });
  fast = modelsRepo.upsert(provider.id, { modelId: 'fast', caps: { thinking: false, image: false, pdf: false }, isDefault: true });
  smart = modelsRepo.upsert(provider.id, { modelId: 'smart', caps: { thinking: true, image: true, pdf: true } });
  settings = { ...structuredClone(DEFAULT_JEV_ROUTING), enabled: true, fallbackProfileId: 'fast', profiles: [
    { id: 'fast', name: 'Quick', modelId: fast.id, speed: 5, intelligence: 2, reasoning: 'off', description: 'Short tasks' },
    { id: 'smart', name: 'Deep', modelId: smart.id, speed: 2, intelligence: 5, reasoning: 'high', description: 'Complex tasks' },
  ] };
  settingsRepo.set('decisions.jev.routing', settings);
  settingsRepo.set('decisions.jev', { model: 'jev-latest', apiKey: 'jev-test-key' });
  vi.mocked(evaluateJev).mockReset().mockResolvedValue(decision());
});
afterEach(async () => { await stopAllRuns(); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
const request = (url: string, body: unknown, method = 'POST') => createApp().request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function create(input: unknown = {}): Promise<Conversation> { return await (await request('/api/conversations', input)).json() as Conversation; }
async function send(id: string, input: unknown = { text: 'Prove a difficult theorem' }) {
  const res = await request(`/api/conversations/${id}/messages`, input);
  const text = await res.text();
  expect(res.status).toBe(200);
  return text;
}

it('routes once before the first LLM call and persists the same model/effort across later turns and restart', async () => {
  const conv = await create({ systemPrompt: 'Keep this exact system prompt.' });
  expect(conv.settings.autoRoute).toBe(true);
  const events = await send(conv.id);
  expect(events).toContain('event: routing');
  expect(calls[0]).toMatchObject({ model: 'smart', reasoning: 'high' });
  expect(calls[0]?.system).toContain('Keep this exact system prompt.');
  expect(calls[0]?.system).not.toContain('Jev');
  const saved = conversationsRepo.get(conv.id)!;
  expect(saved.routing).toMatchObject({ status: 'routed', profileId: 'smart', reasoning: 'high', confidence: 0.9 });
  settingsRepo.set('decisions.jev.routing', { ...settings, enabled: false, profiles: [] });
  closeDb(); initDb(path.join(dir, 'test.db'));
  await send(conv.id, { text: 'Now translate hello' });
  expect(evaluateJev).toHaveBeenCalledTimes(1);
  expect(calls[1]).toMatchObject({ model: 'smart', reasoning: 'high' });
  expect(calls[1]?.system).toBe(calls[0]?.system);
  expect(calls[1]?.messages.slice(0, 1)).toEqual(calls[0]?.messages);
  expect(calls[1]?.messages).toHaveLength(3);
});
it('does not reroute on regeneration, editing the first message or deleting all messages', async () => {
  const conv = await create(); await send(conv.id);
  await send(conv.id, { text: '', regenerate: true });
  const first = messagesRepo.list(conv.id)[0]!;
  await send(conv.id, { text: 'A different first request', editMessageId: first.id });
  messagesRepo.deleteFrom(conv.id, messagesRepo.list(conv.id)[0]!.seq);
  await send(conv.id, { text: 'Fresh text after deletion' });
  expect(evaluateJev).toHaveBeenCalledTimes(1);
  expect(calls.map(c => [c.model, c.reasoning])).toEqual(Array(4).fill(['smart', 'high']));
});
it('does not opt old/manual conversations into routing when the global default changes', async () => {
  const old = conversationsRepo.create({ modelId: fast.id, providerId: fast.providerId });
  const manual = await create({ settings: { autoRoute: false } });
  await send(old.id); await send(manual.id);
  expect(evaluateJev).not.toHaveBeenCalled();
  expect(calls.every(c => c.model === 'fast')).toBe(true);
  const res = await request(`/api/conversations/${old.id}`, { settings: { autoRoute: true } }, 'PUT');
  expect(res.status).toBe(400);
});
it.each(['failure', 'confidence', 'invalid choice'])('pins fallback once for %s and continues the chat', async mode => {
  if (mode === 'failure') vi.mocked(evaluateJev).mockRejectedValue(new Error('network'));
  else vi.mocked(evaluateJev).mockResolvedValue(mode === 'confidence' ? decision('option_1', 0.1) : decision('unconfigured-model'));
  const conv = await create(); await send(conv.id); await send(conv.id, { text: 'next' });
  expect(evaluateJev).toHaveBeenCalledTimes(1);
  expect(conversationsRepo.get(conv.id)?.routing).toMatchObject({ status: 'fallback', profileId: 'fast', reasoning: 'off' });
  expect(calls.map(c => c.model)).toEqual(['fast', 'fast']);
});
it('holds the concurrency guard while Jev runs and cancellation fixes fallback without starting the LLM', async () => {
  vi.mocked(evaluateJev).mockImplementation(async (_input, _key, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
  }));
  const conv = await create();
  const first = await request(`/api/conversations/${conv.id}/messages`, { text: 'First' });
  const consumption = first.text();
  expect(conversationsRepo.get(conv.id)?.routing?.status).toBe('routing');
  expect((await request(`/api/conversations/${conv.id}/messages`, { text: 'Concurrent' })).status).toBe(400);
  activeRuns.get(conv.id)!.abort.abort();
  await consumption;
  expect(calls).toHaveLength(0);
  expect(conversationsRepo.get(conv.id)?.routing?.status).toBe('fallback');
  await send(conv.id, { text: '', regenerate: true });
  expect(evaluateJev).toHaveBeenCalledTimes(1);
  expect(calls[0]?.model).toBe('fast');
});
it('recovers a persisted pending attempt without calling Jev again', async () => {
  const conv = await create(); await send(conv.id);
  const routed = conversationsRepo.get(conv.id)!;
  conversationsRepo.saveRouting(routed, { ...routed.routing!, status: 'routing' });
  vi.mocked(evaluateJev).mockClear();
  closeDb(); initDb(path.join(dir, 'test.db'));
  await send(conv.id, { text: 'Resume' });
  expect(evaluateJev).not.toHaveBeenCalled();
  expect(conversationsRepo.get(conv.id)?.routing?.status).toBe('fallback');
});
it('locks API model/effort changes and refuses a deleted model instead of silently using default', async () => {
  const conv = await create(); await send(conv.id);
  for (const input of [{ modelId: fast.id }, { settings: { reasoning: 'low' } }, { settings: { autoRoute: false } }]) {
    expect((await request(`/api/conversations/${conv.id}`, input, 'PUT')).status).toBe(400);
  }
  expect((await request(`/api/conversations/${conv.id}`, { title: 'New title', settings: { temperature: 0.3 } }, 'PUT')).status).toBe(200);
  modelsRepo.delete(smart.id);
  const events = await send(conv.id, { text: 'next' });
  expect(events).toContain('不会自动切换模型');
  expect(calls).toHaveLength(1); expect(evaluateJev).toHaveBeenCalledTimes(1);
});
it('validates configurable profiles against supported effort without changing model defaults', async () => {
  const original = modelsRepo.get(smart.id);
  const valid = await request('/api/jev/routing', settings, 'PUT');
  expect(valid.status).toBe(200);
  expect(modelsRepo.get(smart.id)).toEqual(original);
  const invalid = { ...settings, profiles: [{ ...settings.profiles[0]!, reasoning: 'high' }] };
  expect((await request('/api/jev/routing', invalid, 'PUT')).status).toBe(400);
  expect((await request('/api/jev/routing', { ...settings, profiles: [settings.profiles[0], settings.profiles[0]] }, 'PUT')).status).toBe(400);
});
it('filters image-incompatible profiles and sends only bounded text/attachment metadata to Jev', async () => {
  settings.fallbackProfileId = 'smart'; settingsRepo.set('decisions.jev.routing', settings);
  vi.mocked(evaluateJev).mockResolvedValue(decision('option_0'));
  const conv = await create();
  messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'image', mime: 'image/png', data: 'do-not-forward-image' }, { type: 'text', text: 'x'.repeat(20000) }] });
  const result = await routeConversation(conv, new AbortController().signal, () => {});
  expect(result.modelId).toBe(smart.id);
  const req = vi.mocked(evaluateJev).mock.calls[0]![0];
  expect(req.questions.route).toMatchObject({ criteria: { option_0: { effort: 'high', speed: 2, intelligence: 5 } } });
  expect(Object.keys((req.questions.route as { criteria: object }).criteria)).toHaveLength(1);
  expect(JSON.stringify(req)).not.toContain('do-not-forward-image');
  expect(req.state).toMatchObject({ first_message: 'x'.repeat(16000), text_truncated: true, has_image: true });
});
it('does not require PDF capability for text and Office documents', async () => {
  const conv = await create();
  messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'document', mime: 'text/plain', name: 'note.txt', attachmentId: 'test' }, { type: 'text', text: 'Summarize' }] });
  await routeConversation(conv, new AbortController().signal, () => {});
  expect(evaluateJev).toHaveBeenCalledTimes(1);
  expect(Object.keys((vi.mocked(evaluateJev).mock.calls[0]![0].questions.route as { criteria: object }).criteria)).toHaveLength(2);
});
