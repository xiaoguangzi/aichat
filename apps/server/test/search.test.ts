import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-search-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

const { initDb, closeDb } = await import('../src/db/database.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { searchIndex, searchMessages, searchableText } = await import('../src/search.js');
const { searchRoute } = await import('../src/routes/search.js');

let convId: string;

beforeEach(() => {
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`));
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  const model = modelsRepo.upsert(provider.id, { modelId: 'gpt' });
  convId = conversationsRepo.create({ providerId: provider.id, modelId: model.id, title: '上下文窗口讨论' }).id;
});
afterEach(() => closeDb());

const add = (role: 'user' | 'assistant', text: string, conversationId = convId) =>
  messagesRepo.create({ conversationId, role, content: [{ type: 'text', text }] });

it('indexes only prose and tool output, not thinking or tool arguments', () => {
  expect(searchableText([
    { type: 'text', text: 'visible prose' },
    { type: 'thinking', thinking: 'hidden reasoning' },
    { type: 'tool_use', id: 't1', name: 'echo', input: { secret: 'argument value' } },
  ])).toBe('visible prose');
  expect(searchableText([
    { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'search result body' }] },
  ])).toBe('search result body');
});

it('finds Chinese text, which the default tokenizer cannot do', async () => {
  add('user', '我们在讨论上下文窗口的限制和缓存前缀');
  // Three or more CJK characters go through the trigram index.
  const hits = searchMessages('上下文窗口');
  expect(hits.map((h) => h.snippet)).toHaveLength(1);
  expect(hits[0]!.snippet).toContain('上下文窗口');
  expect(hits[0]!.conversationTitle).toBe('上下文窗口讨论');
});

it('falls back to a scan for needles shorter than three characters', async () => {
  add('user', '你好，我们今天聊聊缓存');
  // Two-character Chinese words are the common case and the trigram index cannot match them.
  const hits = searchMessages('你好');
  expect(hits).toHaveLength(1);
  expect(hits[0]!.snippet).toContain('你好');
  expect(hits[0]!.role).toBe('user');
});

it('quotes the needle so FTS operators are treated as literal text', async () => {
  add('user', 'use a OR b as the operator');
  add('assistant', 'nothing relevant here');
  // Unquoted, "OR b" would be parsed as a boolean expression and match the second message too.
  const hits = searchMessages('OR b');
  expect(hits).toHaveLength(1);
  expect(hits[0]!.snippet).toContain('OR b');
});

it('filters by conversation, role, group and date', async () => {
  add('user', 'alpha marker', convId);
  const other = conversationsRepo.create({ title: 'other' });
  add('assistant', 'alpha marker again', other.id);

  expect(searchMessages('alpha marker')).toHaveLength(2);
  expect(searchMessages('alpha marker', { conversationId: convId })).toHaveLength(1);
  expect(searchMessages('alpha marker', { role: 'assistant' }).map((h) => h.conversationId)).toEqual([other.id]);
  expect(searchMessages('alpha marker', { groupId: 'none' })).toHaveLength(2);
  expect(searchMessages('alpha marker', { groupId: 'missing' })).toHaveLength(0);
  expect(searchMessages('alpha marker', { since: new Date(Date.now() + 86_400_000).toISOString() })).toHaveLength(0);
});

it('marks a hit that sits on a superseded version', async () => {
  const question = add('user', 'the needle question');
  const first = messagesRepo.create({
    conversationId: convId, role: 'assistant', parentId: question.id,
    content: [{ type: 'text', text: 'answer with needle' }],
  });
  const second = messagesRepo.fork(first.id, [{ type: 'text', text: 'a different reply' }]);
  conversationsRepo.setActiveBranch(convId, [question.id, second!.id]);

  const hits = searchMessages('needle');
  expect(hits).toHaveLength(2);
  const byId = new Map(hits.map((h) => [h.messageId, h]));
  expect(byId.get(question.id)!.visible).toBe(true);
  // The superseded answer is still searchable, but the UI can warn that it is hidden.
  expect(byId.get(first.id)!.visible).toBe(false);
});

it('drops index entries when messages are deleted', async () => {
  add('user', 'ephemeral needle text');
  expect(searchMessages('ephemeral needle')).toHaveLength(1);
  const row = messagesRepo.listAll(convId)[0]!;
  messagesRepo.deleteFrom(convId, row.seq);
  expect(searchMessages('ephemeral needle')).toHaveLength(0);
});

it('updates the index when a message body changes', async () => {
  const message = add('assistant', 'original wording here');
  expect(searchMessages('original wording')).toHaveLength(1);
  messagesRepo.update(message.id, { content: [{ type: 'text', text: 'replacement wording here' }] });
  expect(searchMessages('original wording')).toHaveLength(0);
  expect(searchMessages('replacement wording')).toHaveLength(1);
});

it('backfills rows the index never saw', async () => {
  add('user', 'backfill needle');
  // Simulate a row written before the index existed.
  messagesRepo.deleteFrom(convId, 0);
  const orphanIndex = searchIndex.count();
  expect(orphanIndex).toBe(0);
  add('user', 'backfill needle again');
  expect(searchIndex.reindexMissing()).toBe(0);
  expect(searchMessages('backfill needle')).toHaveLength(1);
});

it('serves search and reindex over HTTP', async () => {
  add('user', 'http searchable text');
  const request = (url: string, method = 'GET') => searchRoute.request(url, { method });
  const hits = await (await request('/?q=http%20searchable')).json() as Array<{ messageId: string; snippet: string }>;
  expect(hits).toHaveLength(1);
  expect(hits[0]!.snippet).toContain('http searchable');

  const filtered = await (await request('/?q=http%20searchable&role=assistant')).json() as unknown[];
  expect(filtered).toHaveLength(0);

  const reindex = await (await request('/reindex', 'POST')).json() as { indexed: number; total: number };
  expect(reindex.total).toBe(1);
});
