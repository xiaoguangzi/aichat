import type { Block, Message, MessageModel, MessageVariants, Role, StopReason, TurnTiming, Usage } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { searchIndex } from '../../search.js';
import { nowIso, uuid } from '../../util/id.js';

interface Row {
  id: string;
  conversation_id: string;
  seq: number;
  role: Role;
  content_json: string;
  usage_json: string | null;
  timing_json: string | null;
  model_json: string | null;
  parent_id: string | null;
  stop_reason: StopReason | null;
  created_at: string;
}

const rowTo = (r: Row): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  seq: r.seq,
  role: r.role,
  content: j.parse<Block[]>(r.content_json, []),
  usage: j.parse<Usage | null>(r.usage_json, null),
  timing: j.parse<TurnTiming | null>(r.timing_json, null),
  model: j.parse<MessageModel | null>(r.model_json, null),
  parentId: r.parent_id ?? null,
  stopReason: r.stop_reason,
  createdAt: r.created_at,
});

const parentOf = (id: string | null | undefined): string | null => id ?? null;

/**
 * Which messages are visible for a conversation.
 *
 * With no recorded branch every row is visible in sequence order: that keeps conversations the
 * delete-based code already flattened, and conversations with no alternates, behaving exactly as
 * before. Once a branch exists, visibility is "follow `parentId` down from the root, taking each
 * step's recorded child, or the newest one at that step when nothing is recorded". Invariant this
 * relies on: every message except the first of a conversation has a parent, so the shape is a tree
 * rather than a forest.
 */
function visibleIds(conversationId: string, branch: string[] | null): string[] {
  const rows = getDb()
    .prepare('SELECT id, parent_id FROM messages WHERE conversation_id = ? ORDER BY seq')
    .all(conversationId) as unknown as { id: string; parent_id: string | null }[];
  if (!branch?.length) return rows.map((r) => r.id);

  const children = new Map<string | null, string[]>(); // insertion order = seq order = newest last
  for (const row of rows) {
    const key = row.parent_id ?? null;
    const list = children.get(key);
    if (list) list.push(row.id);
    else children.set(key, [row.id]);
  }
  // A branch change can leave stale ids behind (for example when a subtree was deleted); the walk
  // simply resolves what is still reachable instead of trusting the stored path verbatim.
  const start = branch.find((id) => rows.some((r) => r.id === id && !r.parent_id)) ?? rows.find((r) => !r.parent_id)?.id;
  if (!start) return [];

  const out: string[] = [];
  let current: string | undefined = start;
  const guard = rows.length + 1;
  while (current && out.length < guard) {
    out.push(current);
    const options: string[] = children.get(current) ?? [];
    const recorded = branch[out.length];
    current = (recorded && options.includes(recorded) ? recorded : options.at(-1)) || undefined;
  }
  return out;
}

export const messagesRepo = {
  /** Raw rows, ignoring branches. Used by search and the export of a whole conversation. */
  listAll(conversationId: string): Message[] {
    return (
      getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq').all(conversationId) as unknown as Row[]
    ).map(rowTo);
  },
  /** Messages on the conversation's active branch, in order. */
  list(conversationId: string, branch: string[] | null = null): Message[] {
    const visible = new Set(visibleIds(conversationId, branch));
    return this.listAll(conversationId).filter((m) => visible.has(m.id));
  },
  get(id: string): Message | null {
    const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  childrenOf(conversationId: string, parentId: string | null): Message[] {
    const rows = (parentId
      ? getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? AND parent_id = ? ORDER BY seq').all(conversationId, parentId)
      : getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? AND parent_id IS NULL ORDER BY seq').all(conversationId)) as unknown as Row[];
    return rows.map(rowTo);
  },
  create(input: {
    conversationId: string; role: Role; content: Block[]; parentId?: string | null;
    usage?: Usage | null; timing?: TurnTiming | null; model?: MessageModel | null; stopReason?: StopReason | null; id?: string;
  }): Message {
    const db = getDb();
    const seqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE conversation_id = ?').get(input.conversationId) as {
      s: number;
    };
    const id = input.id ?? uuid();
    db.prepare(
      'INSERT INTO messages(id,conversation_id,seq,role,content_json,usage_json,stop_reason,created_at,timing_json,model_json,parent_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      input.conversationId,
      seqRow.s,
      input.role,
      j.str(input.content),
      input.usage ? j.str(input.usage) : null,
      input.stopReason ?? null,
      nowIso(),
      input.timing ? j.str(input.timing) : null,
      input.model ? j.str(input.model) : null,
      parentOf(input.parentId),
    );
    const created = this.get(id)!;
    searchIndex.put(created);
    return created;
  },
  /**
   * Create a sibling answer instead of overwriting one: same position, same parent, new body.
   * The caller switches the branch to the returned row.
   */
  fork(sourceId: string, content?: Block[]): Message | null {
    const source = this.get(sourceId);
    if (!source) return null;
    return this.create({
      conversationId: source.conversationId,
      role: source.role,
      content: content ?? source.content,
      parentId: source.parentId,
    });
  },
  /**
   * Variant position of each visible message that has siblings, so the UI can offer ‹ n/m › once
   * without the message tree ever leaving the server.
   */
  variants(conversationId: string): Record<string, MessageVariants> {
    const siblings = new Map<string, string[]>();
    for (const message of this.listAll(conversationId)) {
      const key = message.parentId ?? '';
      const list = siblings.get(key);
      if (list) list.push(message.id);
      else siblings.set(key, [message.id]);
    }
    const out: Record<string, MessageVariants> = {};
    for (const ids of siblings.values()) {
      if (ids.length < 2) continue;
      ids.forEach((id, index) => { out[id] = { index: index + 1, total: ids.length, siblingIds: ids }; });
    }
    return out;
  },
  update(id: string, input: Partial<{ content: Block[]; usage: Usage | null; timing: TurnTiming | null; stopReason: StopReason | null }>): Message | null {
    const cur = this.get(id);
    if (!cur) return null;
    getDb()
      .prepare('UPDATE messages SET content_json=?, usage_json=?, stop_reason=?, timing_json=? WHERE id=?')
      .run(
        j.str(input.content ?? cur.content),
        input.usage === undefined ? (cur.usage ? j.str(cur.usage) : null) : input.usage ? j.str(input.usage) : null,
        input.stopReason === undefined ? (cur.stopReason ?? null) : input.stopReason,
        input.timing === undefined ? (cur.timing ? j.str(cur.timing) : null) : input.timing ? j.str(input.timing) : null,
        id,
      );
    const updated = this.get(id);
    if (updated) searchIndex.put(updated);
    return updated;
  },
  /** Delete this message and everything after it in the conversation. */
  deleteFrom(conversationId: string, seq: number) {
    const db = getDb();
    const doomed = (db.prepare('SELECT id FROM messages WHERE conversation_id = ? AND seq >= ?').all(conversationId, seq) as unknown as { id: string }[]).map((r) => r.id);
    searchIndex.remove(doomed);
    db.prepare('DELETE FROM api_traces WHERE conversation_id = ? AND message_id IN (SELECT id FROM messages WHERE conversation_id = ? AND seq >= ?)').run(conversationId, conversationId, seq);
    db.prepare('DELETE FROM request_diagnostics WHERE conversation_id = ? AND message_id IN (SELECT id FROM messages WHERE conversation_id = ? AND seq >= ?)').run(conversationId, conversationId, seq);
    db.prepare('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?').run(conversationId, seq);
    this.pruneOrphans(conversationId);
  },
  delete(id: string) {
    const message = this.get(id);
    searchIndex.remove([id]);
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
    if (message) this.pruneOrphans(message.conversationId);
  },
  /**
   * Drop rows no walk can reach any more (their ancestor chain no longer starts at a root). Without
   * this, deleting one branch would leave its descendants invisible but still counted by search and
   * export.
   */
  pruneOrphans(conversationId: string): number {
    const db = getDb();
    const rows = db.prepare('SELECT id, parent_id FROM messages WHERE conversation_id = ?').all(conversationId) as unknown as
      { id: string; parent_id: string | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const reachable = new Set<string>();
    // Breadth-first from every root, so a cycle can never be entered and a row whose parent was
    // deleted is simply never visited.
    const queue = rows.filter((r) => !r.parent_id).map((r) => r.id);
    while (queue.length) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const row of rows) if (row.parent_id === id) queue.push(row.id);
    }
    const orphans = rows.filter((r) => !reachable.has(r.id)).map((r) => r.id);
    if (!orphans.length) return 0;
    const placeholders = orphans.map(() => '?').join(',');
    searchIndex.remove(orphans);
    db.prepare(`DELETE FROM api_traces WHERE message_id IN (${placeholders})`).run(...orphans);
    db.prepare(`DELETE FROM request_diagnostics WHERE message_id IN (${placeholders})`).run(...orphans);
    db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...orphans);
    return orphans.length;
  },
};
