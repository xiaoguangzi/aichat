import type { Attachment } from '@aichat/shared';
import { getDb } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

export interface AttachmentRecord extends Attachment {
  path: string;
  conversationId: string | null;
}

interface Row {
  id: string;
  conversation_id: string | null;
  filename: string;
  mime: string;
  size: number;
  path: string;
  created_at: string;
}

const rowTo = (r: Row): AttachmentRecord => ({
  id: r.id,
  conversationId: r.conversation_id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  path: r.path,
  createdAt: r.created_at,
  url: `/api/uploads/${r.id}`,
});

export const attachmentsRepo = {
  get(id: string): AttachmentRecord | null {
    const r = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? rowTo(r) : null;
  },
  create(input: { id?: string; conversationId?: string | null; filename: string; mime: string; size: number; path: string }): AttachmentRecord {
    const id = input.id ?? uuid();
    getDb()
      .prepare('INSERT INTO attachments(id,conversation_id,filename,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, input.conversationId ?? null, input.filename, input.mime, input.size, input.path, nowIso());
    return this.get(id)!;
  },
};
