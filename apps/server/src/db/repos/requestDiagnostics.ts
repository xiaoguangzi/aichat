import { getDb } from '../database.js';
import type { RequestDiagnostic } from '../../llm/diagnostics.js';

export const requestDiagnosticsRepo = {
  list(conversationId: string) {
    return (getDb().prepare('SELECT id,message_id,provider_id,data_json FROM request_diagnostics WHERE conversation_id=? ORDER BY id').all(conversationId) as { id: number; message_id: string; provider_id: string; data_json: string }[])
      .map(row => ({ id: row.id, messageId: row.message_id, providerId: row.provider_id, data: JSON.parse(row.data_json) as RequestDiagnostic }));
  },
  save(conversationId: string, messageId: string, providerId: string, data: RequestDiagnostic) {
    const db = getDb();
    db.prepare('INSERT INTO request_diagnostics(conversation_id,message_id,provider_id,data_json) VALUES (?,?,?,?)')
      .run(conversationId, messageId, providerId, JSON.stringify(data));
    // Bounded local evidence; no prompts, tool schemas, request headers or API keys.
    db.prepare('DELETE FROM request_diagnostics WHERE id <= (SELECT id FROM request_diagnostics ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
  },
};
