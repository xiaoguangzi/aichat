import { getDb } from '../database.js';
import { nowIso, uuid } from '../../util/id.js';

interface ToolResultResource {
  id: string;
  tool_name: string;
  text: string;
}

/** Originals are conversation-scoped and deleted by the conversation's FK cascade. */
export const toolResultsRepo = {
  create(conversationId: string, toolName: string, text: string): ToolResultResource {
    const id = `result_${uuid()}`;
    getDb().prepare('INSERT INTO tool_result_resources(id, conversation_id, tool_name, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, conversationId, toolName, text, nowIso());
    return { id, tool_name: toolName, text };
  },
  get(conversationId: string, id: string): ToolResultResource | null {
    const row = getDb().prepare('SELECT id, tool_name, text FROM tool_result_resources WHERE id = ? AND conversation_id = ?')
      .get(id, conversationId) as unknown as ToolResultResource | undefined;
    return row ?? null;
  },
  has(conversationId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM tool_result_resources WHERE conversation_id = ? LIMIT 1').get(conversationId);
  },
};
