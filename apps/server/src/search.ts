import type { Block, Message, SearchHit, SearchOptions } from '@aichat/shared';
import { getDb } from './db/database.js';
import { messagesRepo } from './db/repos/messages.js';

/** Below this length the trigram index cannot match at all, so the caller must scan instead. */
export const MIN_FTS_QUERY = 3;
/** Snippet context either side of a hit, in characters. */
const SNIPPET_PAD = 60;
const DEFAULT_LIMIT = 40;

/** Searchable text of a message: prose plus what tools actually returned. */
export function searchableText(content: Block[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'tool_result') {
      for (const part of block.content) if (part.type === 'text') parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

/**
 * Keep the index in step with the rows. It is a contentless FTS5 table keyed by the message's
 * rowid, so an update is "delete then insert" and a deleted row can never leave a stale entry
 * behind.
 */
export const searchIndex = {
  put(message: Pick<Message, 'id' | 'content'>) {
    const db = getDb();
    const row = db.prepare('SELECT rowid FROM messages WHERE id = ?').get(message.id) as { rowid: number } | undefined;
    if (!row) return;
    db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.rowid);
    const body = searchableText(message.content);
    if (body) db.prepare('INSERT INTO messages_fts(rowid, body) VALUES (?, ?)').run(row.rowid, body);
  },
  remove(ids: string[]) {
    if (!ids.length) return;
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM messages_fts WHERE rowid IN (SELECT rowid FROM messages WHERE id IN (${placeholders}))`).run(...ids);
  },
  /** Rows that exist but were never indexed: a fresh migration, or an interrupted write. */
  reindexMissing(): number {
    const db = getDb();
    const rows = db.prepare(`SELECT m.id, m.content_json FROM messages m
      WHERE NOT EXISTS (SELECT 1 FROM messages_fts f WHERE f.rowid = m.rowid)`).all() as unknown as { id: string; content_json: string }[];
    let indexed = 0;
    for (const row of rows) {
      let content: Block[] = [];
      try {
        content = JSON.parse(row.content_json) as Block[];
      } catch {
        continue; // An unreadable row cannot be indexed, but must not stop the backfill.
      }
      this.put({ id: row.id, content });
      indexed += 1;
    }
    return indexed;
  },
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n;
  },
};

/** Quote a user string for an FTS5 MATCH expression so punctuation is treated literally. */
const asPhrase = (query: string) => `"${query.replace(/"/g, '""')}"`;

function snippetAround(text: string, needle: string, pad = SNIPPET_PAD): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const index = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return flat.slice(0, pad * 2);
  const start = Math.max(0, index - pad);
  const end = Math.min(flat.length, index + needle.length + pad);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

interface HitRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  seq: number;
  createdAt: string;
  contentJson: string;
  title: string;
  activeBranch: string | null;
}

/**
 * Message-level search. Long needles use the trigram index (ranked, scales with the database);
 * short ones — including the two-character Chinese words that tokenizer cannot match — fall back to
 * a LIKE scan. Both paths return the same shape, and hits on a superseded version are flagged so
 * the UI can warn instead of appearing to jump nowhere.
 */
export function searchMessages(query: string, options: SearchOptions = {}): SearchHit[] {
  const needle = query.trim();
  if (!needle) return [];
  const limit = Math.max(1, Math.min(200, options.limit ?? DEFAULT_LIMIT));
  const db = getDb();

  const filters: string[] = [];
  const params: (string | number)[] = [];
  if (options.conversationId) {
    filters.push('m.conversation_id = ?');
    params.push(options.conversationId);
  }
  if (options.role) {
    filters.push('m.role = ?');
    params.push(options.role);
  }
  if (options.groupId === 'none') filters.push('c.group_id IS NULL');
  else if (options.groupId) {
    filters.push('c.group_id = ?');
    params.push(options.groupId);
  }
  if (options.since) {
    filters.push('m.created_at >= ?');
    params.push(options.since);
  }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const columns = `m.id, m.conversation_id AS conversationId, m.role, m.seq, m.created_at AS createdAt,
    m.content_json AS contentJson, c.title AS title, c.active_branch AS activeBranch`;

  const rows = needle.length >= MIN_FTS_QUERY
    ? db.prepare(`SELECT ${columns} FROM messages_fts f
        JOIN messages m ON m.rowid = f.rowid
        JOIN conversations c ON c.id = m.conversation_id
        WHERE messages_fts MATCH ? ${where}
        ORDER BY rank LIMIT ?`).all(asPhrase(needle), ...params, limit) as unknown as HitRow[]
    : db.prepare(`SELECT ${columns} FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content_json LIKE ? ${where}
        ORDER BY m.created_at DESC LIMIT ?`).all(`%${needle}%`, ...params, limit) as unknown as HitRow[];

  const visible = new Map<string, Set<string>>();
  const visibleIn = (conversationId: string, activeBranch: string | null) => {
    let set = visible.get(conversationId);
    if (!set) {
      let branch: string[] = [];
      try {
        branch = activeBranch ? (JSON.parse(activeBranch) as string[]) : [];
      } catch {
        branch = [];
      }
      set = new Set(messagesRepo.list(conversationId, branch).map((m) => m.id));
      visible.set(conversationId, set);
    }
    return set;
  };

  return rows.map((row) => {
    let content: Block[] = [];
    try {
      content = JSON.parse(row.contentJson) as Block[];
    } catch {
      content = [];
    }
    return {
      messageId: row.id,
      conversationId: row.conversationId,
      conversationTitle: row.title,
      role: row.role,
      seq: row.seq,
      createdAt: row.createdAt,
      snippet: snippetAround(searchableText(content), needle),
      visible: visibleIn(row.conversationId, row.activeBranch).has(row.id),
    };
  });
}
