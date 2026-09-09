import type { ArtifactEdit } from '@aichat/shared';
import { getDb } from '../database.js';
import { uuid, nowIso } from '../../util/id.js';

export const artifactsRepo = {
  list(conversationId: string): ArtifactEdit[] {
    return getDb().prepare('SELECT id, message_id AS messageId, artifact_id AS artifactId, code, created_at AS createdAt FROM artifact_edits WHERE conversation_id = ? ORDER BY created_at, rowid').all(conversationId) as unknown as ArtifactEdit[];
  },
  create(conversationId: string, input: { messageId: string; artifactId: string; code: string }): ArtifactEdit {
    const edit = { ...input, id: uuid(), createdAt: nowIso() };
    getDb().prepare('INSERT INTO artifact_edits(id, conversation_id, message_id, artifact_id, code, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(edit.id, conversationId, edit.messageId, edit.artifactId, edit.code, edit.createdAt);
    return edit;
  },
};
