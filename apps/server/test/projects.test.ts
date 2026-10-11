import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// vi.mock hoists above imports, so config must not be trusted to pick up DATA_DIR.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-project-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

vi.mock('../src/agent/title.js', () => ({ generateTitle: async () => null }));

const { initDb, closeDb } = await import('../src/db/database.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { groupsRepo } = await import('../src/db/repos/groups.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { createApp } = await import('../src/app.js');
const { branchPathFor } = await import('../src/agent/branches.js');
const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');
const { createBackup, backupList } = await import('../src/db/backup.js');

let modelId: string;
let otherModelId: string;

beforeEach(() => {
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`));
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  modelId = modelsRepo.upsert(provider.id, { modelId: 'project-model', isDefault: true }).id;
  otherModelId = modelsRepo.upsert(provider.id, { modelId: 'other' }).id;
});
afterEach(() => closeDb());

const app = () => createApp();
const json = { 'Content-Type': 'application/json' };
const post = (url: string, body: unknown) => app().request(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
const put = (url: string, body: unknown) => app().request(url, { method: 'PUT', headers: json, body: JSON.stringify(body) });

it('inherits project defaults but lets an explicit choice win', async () => {
  const group = groupsRepo.create({
    name: '研究',
    instructions: 'Answer in Chinese.',
    modelId: otherModelId,
    settings: { temperature: 0.2, enabledSkills: ['example'] },
  });

  const inherited = (await (await post('/api/conversations', { groupId: group.id })).json()) as {
    modelId: string; settings: Record<string, unknown>;
  };
  expect(inherited.modelId).toBe(otherModelId);
  expect(inherited.settings).toMatchObject({ temperature: 0.2, enabledSkills: ['example'] });

  // The picker's current selection is not overridden by the project.
  const explicit = (await (await post('/api/conversations', { groupId: group.id, modelId })).json()) as { modelId: string };
  expect(explicit.modelId).toBe(modelId);
  // A conversation outside the project gets no project defaults.
  const outside = (await (await post('/api/conversations', {})).json()) as { modelId: string; settings: Record<string, unknown> };
  expect(outside.modelId).toBe(modelId);
  expect(outside.settings.temperature).toBeUndefined();
});

it('composes standing instructions at request time rather than copying them', async () => {
  const group = groupsRepo.create({ name: 'P', instructions: 'Always cite sources.' });
  const conv = conversationsRepo.create({ groupId: group.id, modelId });
  expect(buildSystemPrompt(conv, { hasTools: false, projectInstructions: groupsRepo.get(group.id)?.instructions })).toContain('Always cite sources.');

  // Editing the project changes what an existing conversation sends, because nothing was copied.
  groupsRepo.update(group.id, { instructions: 'Always answer in Chinese.' });
  const prompt = buildSystemPrompt(conv, { hasTools: false, projectInstructions: groupsRepo.get(group.id)?.instructions });
  expect(prompt).toContain('Always answer in Chinese.');
  expect(prompt).not.toContain('Always cite sources.');

  // A project with no instructions still gets the default assistant framing.
  const bare = groupsRepo.create({ name: 'Bare' });
  const empty = conversationsRepo.create({ groupId: bare.id, modelId });
  expect(buildSystemPrompt(empty, { hasTools: false, projectInstructions: groupsRepo.get(bare.id)?.instructions })).toContain('helpful assistant');
});

it('clears a single project default with null and leaves others alone', async () => {
  const group = groupsRepo.create({ name: 'P', settings: { temperature: 0.5, maxTokens: 1000 } });
  const updated = groupsRepo.update(group.id, { settings: { temperature: null } });
  expect(updated!.settings.temperature).toBeUndefined();
  expect(updated!.settings.maxTokens).toBe(1000);
});

it('serves project defaults through the groups routes', async () => {
  const created = (await (await post('/api/groups', { name: 'Work', instructions: 'Be terse.' })).json()) as { id: string; instructions: string };
  expect(created.instructions).toBe('Be terse.');
  const updated = (await (await put(`/api/groups/${created.id}`, { modelId: otherModelId, settings: { reasoning: 'high' } })).json()) as { modelId: string; settings: Record<string, unknown> };
  expect(updated.modelId).toBe(otherModelId);
  expect(updated.settings.reasoning).toBe('high');
});

it('writes a consistent snapshot while the database stays open', async () => {
  const conv = conversationsRepo.create({ title: 'backup me', modelId });
  const info = createBackup();
  expect(info.bytes).toBeGreaterThan(0);
  // The snapshot is a real database with the data in it, not a copied WAL-less file.
  const { DatabaseSync } = await import('node:sqlite');
  const snapshot = new DatabaseSync(path.join(tmp, 'backups', info.name), { readOnly: true });
  const row = snapshot.prepare('SELECT title FROM conversations WHERE id = ?').get(conv.id) as { title: string } | undefined;
  expect(row?.title).toBe('backup me');
  snapshot.close();
  // Every conversation is still readable through the live connection after VACUUM INTO.
  expect(conversationsRepo.get(conv.id)!.title).toBe('backup me');
});

it('keeps only the newest snapshots', async () => {
  for (let i = 0; i < 12; i++) createBackup();
  const { backups, max } = backupList();
  expect(max).toBe(10);
  expect(backups.length).toBeLessThanOrEqual(max);
  // The README explains how to restore and what is missing from the snapshot.
  expect(fs.readFileSync(path.join(tmp, 'backups', 'README.txt'), 'utf8')).toContain('uploads');
});

it('exposes branch paths for a message that has siblings', async () => {
  const conv = conversationsRepo.create({ title: 'branch', modelId });
  const { messagesRepo } = await import('../src/db/repos/messages.js');
  const q = messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'q' }] });
  const a1 = messagesRepo.create({ conversationId: conv.id, role: 'assistant', parentId: q.id, content: [{ type: 'text', text: 'a1' }] });
  const a2 = messagesRepo.create({ conversationId: conv.id, role: 'assistant', parentId: q.id, content: [{ type: 'text', text: 'a2' }] });
  expect(branchPathFor(conv.id, a1.id)).toEqual([q.id, a1.id]);
  expect(branchPathFor(conv.id, a2.id)).toEqual([q.id, a2.id]);
});
