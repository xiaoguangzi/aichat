import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-actions-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

const { initDb, closeDb } = await import('../src/db/database.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { createApp } = await import('../src/app.js');

let convId: string;

beforeEach(() => {
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`));
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  const model = modelsRepo.upsert(provider.id, { modelId: 'gpt' });
  convId = conversationsRepo.create({ providerId: provider.id, modelId: model.id, title: 'c' }).id;
});
afterEach(() => closeDb());

const app = () => createApp();
const json = { 'Content-Type': 'application/json' };
const request = (url: string, method: string, body?: unknown) =>
  app().request(url, { method, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Chained parents, like a real conversation: this is what the undo must preserve. */
const seed = () => {
  let parent: string | null = null;
  for (const [role, text] of [['user', 'q1'], ['assistant', 'a1'], ['user', 'q2'], ['assistant', 'a2']] as const) {
    parent = messagesRepo.create({ conversationId: convId, role, parentId: parent, content: [{ type: 'text', text }] }).id;
  }
};

it('pins a conversation without touching its recency order', async () => {
  const before = conversationsRepo.get(convId)!;
  const pinned = (await (await request(`/api/conversations/${convId}`, 'PUT', { pinned: true })).json()) as { pinned: boolean; updatedAt: string };
  expect(pinned.pinned).toBe(true);
  // Tidying the sidebar must not reshuffle it.
  expect(pinned.updatedAt).toBe(before.updatedAt);
  // Pinned first, then recency.
  const second = conversationsRepo.create({ title: 'newer' });
  const list = (await (await request('/api/conversations', 'GET')).json()) as Array<{ id: string }>;
  expect(list[0]!.id).toBe(convId);
  expect(list.map((c) => c.id)).toContain(second.id);

  const unpinned = (await (await request(`/api/conversations/${convId}`, 'PUT', { pinned: false })).json()) as { pinned: boolean };
  expect(unpinned.pinned).toBe(false);
});

it('restores the last deleted batch, keeping ids, parents and usage', async () => {
  seed();
  const all = messagesRepo.listAll(convId);
  const q2 = all[2]!;
  const deleted = (await (await request(`/api/conversations/${convId}/messages/${q2.id}`, 'DELETE')).json()) as { deleted: number };
  expect(deleted.deleted).toBe(2);
  expect(messagesRepo.listAll(convId)).toHaveLength(2);

  const restored = (await (await request(`/api/conversations/${convId}/undo-delete`, 'POST')).json()) as {
    restored: number; messages: Array<{ id: string; parentId: string | null }>;
  };
  expect(restored.restored).toBe(2);
  expect(restored.messages.map((m) => m.id)).toEqual(all.map((m) => m.id));
  // Parents survive the round trip, so the branch walk still works afterwards.
  expect(restored.messages[2]!.parentId).toBe(all[1]!.id);
});

it('reports nothing to undo instead of silently succeeding', async () => {
  seed();
  const res = await request(`/api/conversations/${convId}/undo-delete`, 'POST');
  expect(res.status).toBe(400);
  expect(((await res.json()) as { message: string }).message).toContain('没有可撤销');
});

it('only offers the undo once', async () => {
  seed();
  const q2 = messagesRepo.listAll(convId)[2]!;
  await request(`/api/conversations/${convId}/messages/${q2.id}`, 'DELETE');
  expect((await request(`/api/conversations/${convId}/undo-delete`, 'POST')).status).toBe(200);
  expect((await request(`/api/conversations/${convId}/undo-delete`, 'POST')).status).toBe(400);
});

it('accepts the new sampling parameters and clears them with null', async () => {
  const saved = (await (await request(`/api/conversations/${convId}`, 'PUT', {
    settings: { topP: 0.9, stop: ['###', 'STOP'], temperature: 0.3 },
  })).json()) as { settings: Record<string, unknown> };
  expect(saved.settings).toMatchObject({ topP: 0.9, stop: ['###', 'STOP'], temperature: 0.3 });

  const cleared = (await (await request(`/api/conversations/${convId}`, 'PUT', { settings: { topP: null, stop: null } })).json()) as { settings: Record<string, unknown> };
  expect(cleared.settings.topP).toBeUndefined();
  expect(cleared.settings.stop).toBeUndefined();
  // Unrelated settings are left alone by a partial update.
  expect(cleared.settings.temperature).toBe(0.3);

  // Out-of-range values are rejected rather than forwarded to the endpoint.
  expect((await request(`/api/conversations/${convId}`, 'PUT', { settings: { topP: 1.5 } })).status).toBe(400);
  expect((await request(`/api/conversations/${convId}`, 'PUT', { settings: { stop: ['a', 'b', 'c', 'd', 'e'] } })).status).toBe(400);
});
