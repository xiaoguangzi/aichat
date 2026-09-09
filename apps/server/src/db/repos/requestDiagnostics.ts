import { getDb } from '../database.js';
import type { RequestDiagnostic } from '../../llm/diagnostics.js';

export const requestDiagnosticsRepo = {
  save(conversationId: string, messageId: string, providerId: string, data: RequestDiagnostic) {
    const db = getDb();
    db.prepare('INSERT INTO request_diagnostics(conversation_id,message_id,provider_id,data_json) VALUES (?,?,?,?)')
      .run(conversationId, messageId, providerId, JSON.stringify(data));
    // Bounded local evidence; no prompts, tool schemas, request headers or API keys.
    db.prepare('DELETE FROM request_diagnostics WHERE id <= (SELECT id FROM request_diagnostics ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
  },
};
