import type { Block, Message, Role, StopReason, Usage } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

interface Row {
  id: string;
  conversation_id: string;
  seq: number;
  role: Role;
  content_json: string;
  usage_json: string | null;
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
  stopReason: r.stop_reason,
  createdAt: r.created_at,
});

export const messagesRepo = {
  list(conversationId: string): Message[] {
    return (
      getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq').all(conversationId) as unknown as Row[]
    ).map(rowTo);
  },
  get(id: string): Message | null {
    const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(input: { conversationId: string; role: Role; content: Block[]; usage?: Usage | null; stopReason?: StopReason | null; id?: string }): Message {
    const db = getDb();
    const seqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE conversation_id = ?').get(input.conversationId) as {
      s: number;
    };
    const id = input.id ?? uuid();
    db.prepare(
      'INSERT INTO messages(id,conversation_id,seq,role,content_json,usage_json,stop_reason,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      id,
      input.conversationId,
      seqRow.s,
      input.role,
      j.str(input.content),
      input.usage ? j.str(input.usage) : null,
      input.stopReason ?? null,
      nowIso(),
    );
    return this.get(id)!;
  },
  update(id: string, input: Partial<{ content: Block[]; usage: Usage | null; stopReason: StopReason | null }>): Message | null {
    const cur = this.get(id);
    if (!cur) return null;
    getDb()
      .prepare('UPDATE messages SET content_json=?, usage_json=?, stop_reason=? WHERE id=?')
      .run(
        j.str(input.content ?? cur.content),
        input.usage === undefined ? (cur.usage ? j.str(cur.usage) : null) : input.usage ? j.str(input.usage) : null,
        input.stopReason === undefined ? (cur.stopReason ?? null) : input.stopReason,
        id,
      );
    return this.get(id);
  },
  /** Delete this message and everything after it in the conversation. */
  deleteFrom(conversationId: string, seq: number) {
    getDb().prepare('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?').run(conversationId, seq);
  },
  delete(id: string) {
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
  },
};
