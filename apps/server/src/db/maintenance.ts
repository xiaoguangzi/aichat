import type { PruneResult, StorageStats, TraceRetention } from '@aichat/shared';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './database.js';
import { readTraceStats } from './repos/apiTraces.js';
import { readRetention, readRetentionInput } from './retention.js';
import { uploadsDir } from '../config.js';

export { readRetention, resolveRetention, writeRetention } from './retention.js';

/**
 * Delete request-log rows outside the retention window, oldest first, and optionally reclaim the
 * freed pages. A conversation that is currently generating is skipped as a whole: its log is
 * evidence for a run the UI may still be reading, and the newest row may still be being written.
 */
export function pruneTraces(opts: {
  retention?: TraceRetention;
  protectedConversationIds?: Iterable<string>;
  /** Ignore `autoPrune`; used by the explicit cleanup action. */
  force?: boolean;
  vacuum?: boolean;
} = {}): PruneResult {
  const retention = opts.retention ?? readRetention();
  const protectedIds = [...(opts.protectedConversationIds ?? [])];
  const db = getDb();
  const before = readTraceStats();

  if (!opts.force && !retention.autoPrune) {
    return { deleted: 0, remaining: before.count, bytesFreed: 0, vacuumed: false, reclaimedBytes: 0, protectedConversations: protectedIds.length };
  }

  const guard = protectedIds.length ? `conversation_id NOT IN (${protectedIds.map(() => '?').join(',')})` : '';
  // Each rule deletes only rows the previous rules left behind; `changes` accumulates the total.
  const run = (sql: string, ...params: (string | number)[]) => {
    const result = db.prepare(sql).run(...params);
    return Number(result.changes ?? 0);
  };
  let deleted = 0;

  // maxCount 0 = keep nothing, which is how the explicit clear action is expressed. The byte and
  // age limits instead treat 0 as "no limit", so a saved setting can never silently wipe the log.
  if (retention.maxCount === 0) {
    deleted += guard ? run(`DELETE FROM api_traces WHERE ${guard}`, ...protectedIds) : run('DELETE FROM api_traces');
  } else {
    if (retention.maxAgeDays > 0) {
      const cutoff = new Date(Date.now() - retention.maxAgeDays * 86_400_000).toISOString();
      deleted += guard
        ? run(`DELETE FROM api_traces WHERE started_at < ? AND ${guard}`, cutoff, ...protectedIds)
        : run('DELETE FROM api_traces WHERE started_at < ?', cutoff);
    }
    if (retention.maxCount > 0) {
      deleted += run(`DELETE FROM api_traces WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY started_at DESC, rowid DESC) AS n
            FROM api_traces ${guard ? `WHERE ${guard}` : ''}
          ) WHERE n > ?
        )`, ...protectedIds, retention.maxCount);
    }
    if (retention.maxTotalBytes > 0) {
      deleted += run(`DELETE FROM api_traces WHERE id IN (
          SELECT id FROM (
            SELECT id, SUM(body_bytes) OVER (ORDER BY started_at DESC, rowid DESC) AS bytes
            FROM api_traces ${guard ? `WHERE ${guard}` : ''}
          ) WHERE bytes > ?
        )`, ...protectedIds, retention.maxTotalBytes);
    }
  }

  const after = readTraceStats();
  const bytesFreed = Math.max(0, before.bytes - after.bytes);
  const vacuumed = opts.vacuum ?? retention.vacuumOnPrune;
  const reclaimedBytes = vacuumed && deleted > 0 ? vacuumDb() : 0;
  return { deleted, remaining: after.count, bytesFreed, vacuumed, reclaimedBytes, protectedConversations: protectedIds.length };
}

/** Rebuild the database file so pages freed by deletes are returned to the filesystem. */
export function vacuumDb(): number {
  const db = getDb();
  const beforeBytes = fileBytes();
  // VACUUM cannot run inside a transaction; none is open at this point.
  db.exec('VACUUM');
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Best effort only: a checkpoint failure must not turn a successful VACUUM into an error.
  }
  return Math.max(0, beforeBytes - fileBytes());
}

function fileBytes(): number {
  const page = getDb().prepare('PRAGMA page_count').get() as { page_count: number };
  const size = getDb().prepare('PRAGMA page_size').get() as { page_size: number };
  return page.page_count * size.page_size;
}

/** Automatic runs are debounced, so a busy conversation does not re-scan the log on every reply. */
const AUTO_PRUNE_INTERVAL_MS = 5 * 60_000;
let lastAutoPrune = 0;

/**
 * Enforce retention in the background, called before a run starts. The insert-time guard in the
 * trace repo already caps growth between passes; this exists so age and byte limits are actually
 * applied to a log that is only being read, not written. Never vacuums: a full rewrite is too
 * expensive to trigger implicitly.
 */
export function autoPruneTraces(protectedConversationIds: Iterable<string> = []): PruneResult | null {
  const now = Date.now();
  if (now - lastAutoPrune < AUTO_PRUNE_INTERVAL_MS) return null;
  lastAutoPrune = now;
  try {
    return pruneTraces({ protectedConversationIds, vacuum: false });
  } catch (e) {
    // Retention must never break a chat run; the next pass retries.
    console.warn('Could not prune the request log:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Files under uploads/ that no message references any more. Deleting a message only removes its
 * blocks, so this is the only view of what is actually unreachable on disk.
 */
function orphanedUploads(files: { id: string; bytes: number }[]): { count: number; bytes: number } {
  const referenced = new Set<string>();
  for (const row of getDb().prepare('SELECT content_json FROM messages').all() as { content_json: string }[]) {
    for (const m of row.content_json.matchAll(/"attachmentId"\s*:\s*"([^"]+)"/g)) referenced.add(m[1]!);
  }
  const orphans = files.filter((f) => !referenced.has(f.id));
  return { count: orphans.length, bytes: orphans.reduce((sum, f) => sum + f.bytes, 0) };
}

/** Uploaded ids are the file basename, so an attachment id matches its file without a DB lookup. */
function readUploads(): { id: string; bytes: number }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile()).map((e) => {
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(uploadsDir, e.name)).size;
    } catch {
      // A file that vanished between readdir and stat contributes no bytes.
    }
    return { id: path.parse(e.name).name, bytes };
  });
}

export function storageStats(): StorageStats {
  const db = getDb();
  const page = db.prepare('PRAGMA page_count').get() as { page_count: number };
  const size = db.prepare('PRAGMA page_size').get() as { page_size: number };
  const free = db.prepare('PRAGMA freelist_count').get() as { freelist_count: number };
  const toolResults = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(text)), 0) AS bytes FROM tool_result_resources').get() as { n: number; bytes: number };
  const messages = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content_json)), 0) AS bytes FROM messages').get() as { n: number; bytes: number };
  const files = readUploads();
  const uploads = { count: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0) };
  const orphaned = orphanedUploads(files);
  return {
    retention: readRetention(),
    retentionInput: readRetentionInput(),
    traces: readTraceStats(),
    db: {
      pageCount: page.page_count,
      pageSize: size.page_size,
      freePages: free.freelist_count,
      bytes: page.page_count * size.page_size,
      reclaimableBytes: free.freelist_count * size.page_size,
    },
    uploads: { ...uploads, orphaned: orphaned.count, orphanedBytes: orphaned.bytes },
    toolResults: { count: toolResults.n, bytes: toolResults.bytes },
    messages: { count: messages.n, bytes: messages.bytes },
  };
}
