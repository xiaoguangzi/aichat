import type { ConversationGroup, ConversationSettings } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

interface Row {
  id: string;
  name: string;
  sort_order: number;
  collapsed: number;
  instructions: string;
  model_id: string | null;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

const rowTo = (r: Row): ConversationGroup => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sort_order,
  collapsed: !!r.collapsed,
  instructions: r.instructions ?? '',
  modelId: r.model_id ?? null,
  settings: j.parse<ConversationSettings>(r.settings_json, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const groupsRepo = {
  list(): ConversationGroup[] {
    return (
      getDb()
        .prepare('SELECT * FROM conversation_groups ORDER BY sort_order, created_at')
        .all() as unknown as Row[]
    ).map(rowTo);
  },
  get(id: string): ConversationGroup | null {
    const r = getDb().prepare('SELECT * FROM conversation_groups WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(input: { name: string; collapsed?: boolean; instructions?: string; modelId?: string | null; settings?: ConversationSettings }): ConversationGroup {
    const db = getDb();
    const id = uuid();
    const now = nowIso();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM conversation_groups').get() as { m: number };
    db.prepare('INSERT INTO conversation_groups(id,name,sort_order,collapsed,instructions,model_id,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id,
      input.name,
      Number(max.m) + 1,
      input.collapsed ? 1 : 0,
      input.instructions ?? '',
      input.modelId ?? null,
      j.str(input.settings ?? {}),
      now,
      now,
    );
    return this.get(id)!;
  },
  update(id: string, input: Partial<{ name: string; collapsed: boolean; instructions: string; modelId: string | null; settings: ConversationSettings }>): ConversationGroup | null {
    const cur = this.get(id);
    if (!cur) return null;
    // Settings follow the conversation convention: a null field clears that one default, an absent
    // field is left as it was.
    const settings = input.settings ? { ...cur.settings, ...input.settings } : cur.settings;
    for (const [key, value] of Object.entries(settings)) {
      if (value === null) delete (settings as Record<string, unknown>)[key];
    }
    getDb()
      .prepare('UPDATE conversation_groups SET name=?, collapsed=?, instructions=?, model_id=?, settings_json=?, updated_at=? WHERE id=?')
      .run(
        input.name ?? cur.name,
        (input.collapsed ?? cur.collapsed) ? 1 : 0,
        input.instructions ?? cur.instructions,
        input.modelId === undefined ? cur.modelId : input.modelId,
        j.str(settings),
        nowIso(),
        id,
      );
    return this.get(id);
  },
  /** Applies the given order; ids not listed keep trailing positions. */
  reorder(ids: string[]) {
    const db = getDb();
    const stmt = db.prepare('UPDATE conversation_groups SET sort_order=?, updated_at=? WHERE id=?');
    const now = nowIso();
    db.exec('BEGIN');
    try {
      ids.forEach((id, i) => stmt.run(i, now, id));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
  /** Deletes the group only; its conversations become ungrouped. */
  delete(id: string): boolean {
    const db = getDb();
    db.prepare('UPDATE conversations SET group_id = NULL WHERE group_id = ?').run(id);
    return db.prepare('DELETE FROM conversation_groups WHERE id = ?').run(id).changes > 0;
  },
};
