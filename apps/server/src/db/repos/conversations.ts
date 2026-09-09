import type { Conversation, ConversationSettings } from '@aichat/shared';
import { getDb, j } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

interface Row {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  group_id: string | null;
  system_prompt: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

const rowTo = (r: Row): Conversation => ({
  id: r.id,
  title: r.title,
  providerId: r.provider_id,
  modelId: r.model_id,
  groupId: r.group_id,
  systemPrompt: r.system_prompt,
  settings: j.parse<ConversationSettings>(r.settings_json, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const conversationsRepo = {
  /**
   * `q` matches titles and message text. `groupId` scopes the result to one group
   * ('none' = ungrouped only), which is what the per-group search box sends.
   */
  list(q?: string, groupId?: string | null): Conversation[] {
    const db = getDb();
    const where: string[] = [];
    const params: (string | null)[] = [];
    if (q) {
      const like = `%${q}%`;
      where.push('(c.title LIKE ? OR m.content_json LIKE ?)');
      params.push(like, like);
    }
    if (groupId === 'none') where.push('c.group_id IS NULL');
    else if (groupId) {
      where.push('c.group_id = ?');
      params.push(groupId);
    }
    const sql = `SELECT DISTINCT c.* FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.updated_at DESC LIMIT ${q ? 200 : 500}`;
    return (db.prepare(sql).all(...params) as unknown as Row[]).map(rowTo);
  },
  get(id: string): Conversation | null {
    const r = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(input: {
    title?: string;
    providerId?: string | null;
    modelId?: string | null;
    groupId?: string | null;
    systemPrompt?: string;
    settings?: ConversationSettings;
  }): Conversation {
    const id = uuid();
    const now = nowIso();
    getDb()
      .prepare(
        'INSERT INTO conversations(id,title,provider_id,model_id,group_id,system_prompt,settings_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.title ?? '',
        input.providerId ?? null,
        input.modelId ?? null,
        input.groupId ?? null,
        input.systemPrompt ?? '',
        j.str(input.settings ?? {}),
        now,
        now,
      );
    return this.get(id)!;
  },
  update(
    id: string,
    input: Partial<{
      title: string;
      providerId: string | null;
      modelId: string | null;
      groupId: string | null;
      systemPrompt: string;
      settings: ConversationSettings;
    }>,
  ): Conversation | null {
    const cur = this.get(id);
    if (!cur) return null;
    // Filing a chat into a group is not an edit: bumping updated_at would reshuffle the
    // sidebar (sorted by recency) under the user right after they organised it.
    const onlyMoved = Object.keys(input).length > 0 && Object.keys(input).every((k) => k === 'groupId');
    getDb()
      .prepare('UPDATE conversations SET title=?, provider_id=?, model_id=?, group_id=?, system_prompt=?, settings_json=?, updated_at=? WHERE id=?')
      .run(
        input.title ?? cur.title,
        input.providerId === undefined ? cur.providerId : input.providerId,
        input.modelId === undefined ? cur.modelId : input.modelId,
        input.groupId === undefined ? cur.groupId : input.groupId,
        input.systemPrompt ?? cur.systemPrompt,
        j.str(input.settings ? { ...cur.settings, ...input.settings } : cur.settings),
        onlyMoved ? cur.updatedAt : nowIso(),
        id,
      );
    return this.get(id);
  },
  touch(id: string) {
    getDb().prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(nowIso(), id);
  },
  delete(id: string): boolean {
    return getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  },
};
