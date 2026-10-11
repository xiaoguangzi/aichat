import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApiTraceDetail } from '@aichat/shared';

// Must be set before config.ts is imported: uploadsDir/dbPath are resolved once at module load, and
// pruning must never touch the developer's real data directory.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-maintenance-'));
process.env.DATA_DIR = dir;
process.env.SKILLS_DIR = path.join(dir, 'skills');

const { initDb, closeDb, getDb } = await import('../src/db/database.js');
const { apiTracesRepo, readTraceStats } = await import('../src/db/repos/apiTraces.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { settingsRepo } = await import('../src/db/repos/settings.js');
const { defaultRetention, readRetention, readRetentionInput, resolveRetention, writeRetention } = await import('../src/db/retention.js');
const { pruneTraces, storageStats, vacuumDb } = await import('../src/db/maintenance.js');
const { attachmentsRepo } = await import('../src/db/repos/attachments.js');
const { settingsRoute } = await import('../src/routes/settings.js');
const { uploadsDir } = await import('../src/config.js');

let dbFile: string;
const DEFAULT = defaultRetention();

beforeEach(() => {
  dbFile = path.join(dir, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  initDb(dbFile);
});
afterEach(() => closeDb());

function trace(id: string, conversationId: string, startedAt: string, bodyBytes = 1_000, messageId = 'm-1'): ApiTraceDetail {
  return {
    id, conversationId, turnId: messageId, messageId, providerId: 'p', providerName: 'P', purpose: 'chat',
    protocol: 'openai', model: 'gpt', attempt: 1, startedAt, durationMs: 5, status: 'complete', method: 'POST',
    url: 'https://example.test/v1/chat/completions', bodyAvailable: true, notes: [],
    requestBody: null, requestHeaders: {}, responseBody: 'x'.repeat(bodyBytes), responseHeaders: {},
  };
}

/** Trace rows need a real conversation and message: both ids are foreign keys. */
function conversation(title = 'c') {
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  const model = modelsRepo.upsert(provider.id, { modelId: 'gpt' });
  const conv = conversationsRepo.create({ providerId: provider.id, modelId: model.id, title });
  const message = messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'hi' }] });
  return { conv, messageId: message.id };
}

const body = (id: string) => (getDb().prepare('SELECT body_json FROM api_traces WHERE id = ?').get(id) as { body_json: string } | undefined)?.body_json;

/** Fixtures must stay inside the default age window, so no test depends on today's date. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

it('keeps the built-in limits when nothing is configured, and treats 0 as "no limit"', () => {
  expect(readRetention()).toEqual(DEFAULT);
  expect(resolveRetention(null)).toEqual(DEFAULT);
  // 0 is only special for maxCount (see pruneTraces); it must survive resolution as written so the
  // clear action can express "keep nothing" while byte and age limits read it as unlimited.
  expect(resolveRetention({ maxCount: 0, maxTotalBytes: 0, maxAgeDays: 0 })).toEqual({ ...DEFAULT, maxCount: 0, maxTotalBytes: 0, maxAgeDays: 0 });
  // Partial input keeps defaults for everything omitted.
  expect(resolveRetention({ autoPrune: false })).toEqual({ ...DEFAULT, autoPrune: false });
});

it('stores exactly what was submitted so later default changes still apply', () => {
  writeRetention({ autoPrune: true });
  expect(settingsRepo.get('trace.retention', null)).toEqual({ autoPrune: true });
  expect(readRetention()).toEqual(DEFAULT);
});

it('limits the log by count, dropping the oldest first and leaving other conversations alone', () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 5; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 1_000, messageId));
  const result = pruneTraces({ retention: { ...DEFAULT, maxCount: 3 }, force: true });

  expect(result.deleted).toBe(2);
  expect(result.remaining).toBe(3);
  expect(body('t0')).toBeUndefined();
  expect(body('t1')).toBeUndefined();
  expect(body('t4')).toBeDefined();
});

it('drops rows older than the age limit', () => {
  const { conv, messageId } = conversation();
  const fresh = new Date(Date.now() - 86_400_000).toISOString();
  const stale = new Date(Date.now() - 10 * 86_400_000).toISOString();
  apiTracesRepo.save(trace('old', conv.id, stale, 1_000, messageId));
  apiTracesRepo.save(trace('new', conv.id, fresh, 1_000, messageId));

  expect(pruneTraces({ retention: { ...DEFAULT, maxAgeDays: 5 }, force: true }).deleted).toBe(1);
  expect(body('old')).toBeUndefined();
  expect(body('new')).toBeDefined();
});

it('drops rows beyond the byte budget, counting the newest first', () => {
  const { conv, messageId } = conversation();
  apiTracesRepo.save(trace('a', conv.id, daysAgo(3), 10_000, messageId));
  apiTracesRepo.save(trace('b', conv.id, daysAgo(2), 10_000, messageId));
  apiTracesRepo.save(trace('c', conv.id, daysAgo(1), 10_000, messageId));

  // Budget fits the two newest rows; the oldest falls outside the running total.
  expect(pruneTraces({ retention: { ...DEFAULT, maxTotalBytes: 25_000 }, force: true }).deleted).toBe(1);
  expect(body('a')).toBeUndefined();
  expect(body('b')).toBeDefined();
  expect(body('c')).toBeDefined();
});

it('never prunes a conversation that is currently generating', () => {
  const busy = conversation('busy');
  const idle = conversation('idle');
  for (let i = 0; i < 3; i++) apiTracesRepo.save(trace(`busy-${i}`, busy.conv.id, daysAgo(6 - i), 1_000, busy.messageId));
  for (let i = 0; i < 3; i++) apiTracesRepo.save(trace(`idle-${i}`, idle.conv.id, daysAgo(6 - i), 1_000, idle.messageId));

  const result = pruneTraces({ retention: { ...DEFAULT, maxCount: 1 }, force: true, protectedConversationIds: [busy.conv.id] });

  expect(result.protectedConversations).toBe(1);
  expect(body('busy-0')).toBeDefined();
  expect(body('busy-2')).toBeDefined();
  expect(body('idle-0')).toBeUndefined();
  expect(body('idle-2')).toBeDefined();
});

it('clears every unprotected row when maxCount is 0, which is how the clear action is expressed', () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 4; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 1_000, messageId));

  const result = pruneTraces({ retention: { ...DEFAULT, maxCount: 0 }, force: true });
  expect(result.deleted).toBe(4);
  expect(readTraceStats().count).toBe(0);
});

it('does nothing when automatic pruning is off unless the caller forces it', () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 4; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 1_000, messageId));
  const retention = { ...DEFAULT, autoPrune: false, maxCount: 2 };

  expect(pruneTraces({ retention }).deleted).toBe(0);
  expect(readTraceStats().count).toBe(4);
  expect(pruneTraces({ retention, force: true }).deleted).toBe(2);
  expect(readTraceStats().count).toBe(2);
});

it('holds the log near the ceiling at insert time so one long generation cannot grow the file', () => {
  const { conv, messageId } = conversation();
  writeRetention({ maxCount: 3, maxTotalBytes: 1_000_000, maxAgeDays: 30 });
  for (let i = 0; i < 6; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 1_000, messageId));

  expect(readTraceStats().count).toBe(3);
  expect(body('t5')).toBeDefined();
  expect(body('t0')).toBeUndefined();
});

it('reports what the log and the database cost, including reclaimable pages', () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 5; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 20_000, messageId));
  pruneTraces({ retention: { ...DEFAULT, maxCount: 0 }, force: true });

  const stats = storageStats();
  expect(stats.traces).toEqual({ count: 0, bytes: 0, conversations: 0 });
  expect(stats.db.freePages).toBeGreaterThan(0);
  expect(stats.db.reclaimableBytes).toBeGreaterThan(0);
  expect(stats.db.bytes).toBeGreaterThan(0);
  expect(stats.messages.count).toBe(1);
});

it('keeps a limit unset across a save, so the UI cannot freeze today default into the database', () => {
  const saved = writeRetention({ maxCount: 100 });
  expect(saved).toEqual({ ...DEFAULT, maxCount: 100 });
  // The unset limits are absent from storage and from the raw view the UI seeds its form with.
  expect(readRetentionInput()).toEqual({ maxCount: 100 });
  expect(storageStats().retentionInput).toEqual({ maxCount: 100 });
  // ...while the effective view still reports real numbers for every limit.
  expect(storageStats().retention).toEqual({ ...DEFAULT, maxCount: 100 });
});

it('counts uploads that no message references any more', () => {
  const { conv } = conversation();
  fs.mkdirSync(uploadsDir, { recursive: true });
  const keep = path.join(uploadsDir, 'keep.png');
  const orphan = path.join(uploadsDir, 'orphan.png');
  fs.writeFileSync(keep, Buffer.alloc(10));
  fs.writeFileSync(orphan, Buffer.alloc(30));
  attachmentsRepo.create({ id: 'keep', conversationId: conv.id, filename: 'keep.png', mime: 'image/png', size: 10, path: keep });
  messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'image', mime: 'image/png', attachmentId: 'keep' }] });

  const stats = storageStats();
  expect(stats.uploads.count).toBe(2);
  expect(stats.uploads.orphaned).toBe(1);
  expect(stats.uploads.orphanedBytes).toBe(30);
});

it('returns freed pages to the filesystem on vacuum', () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 12; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(12 - i), 60_000, messageId));
  const before = storageStats().db.bytes;
  pruneTraces({ retention: { ...DEFAULT, maxCount: 0 }, force: true });

  const reclaimed = vacuumDb();
  expect(reclaimed).toBeGreaterThan(0);
  // VACUUM rewrites the file down to the pages actually in use; the logical size is what shrinks,
  // because WAL mode keeps the on-disk file small until a checkpoint folds the log back in.
  expect(storageStats().db.bytes).toBeLessThan(before);
  expect(storageStats().db.freePages).toBe(0);
  expect(readTraceStats().count).toBe(0);
});

it('serves retention, stats and pruning through the settings routes', async () => {
  const { conv, messageId } = conversation();
  for (let i = 0; i < 4; i++) apiTracesRepo.save(trace(`t${i}`, conv.id, daysAgo(6 - i), 1_000, messageId));
  const request = (url: string, method = 'GET', payload?: unknown) =>
    settingsRoute.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

  const saved = await (await request('/?x', 'PUT', { titleModelId: null, traceRetention: { maxCount: 1, maxTotalBytes: 1_000_000, maxAgeDays: 30 } })).json() as { traceRetention: { maxCount: number } };
  // Lowering a limit prunes immediately rather than at the next generation.
  expect(saved.traceRetention.maxCount).toBe(1);
  expect(readTraceStats().count).toBe(1);

  const stats = await (await request('/storage')).json() as { traces: { count: number }; retention: { maxCount: number } };
  expect(stats.traces.count).toBe(1);
  expect(stats.retention.maxCount).toBe(1);

  const cleared = await (await request('/storage/prune?mode=hard&vacuum=true', 'POST')).json() as { deleted: number; remaining: number; vacuumed: boolean };
  expect(cleared).toMatchObject({ deleted: 1, remaining: 0, vacuumed: true });

  const vacuum = await (await request('/storage/vacuum', 'POST')).json() as { reclaimedBytes: number };
  expect(vacuum.reclaimedBytes).toBeGreaterThanOrEqual(0);
});
