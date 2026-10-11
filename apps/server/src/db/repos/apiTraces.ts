import type { ApiTrace, ApiTraceDetail } from '@aichat/shared';
import { getDb } from '../database.js';
import type { TraceSink } from '../../llm/trace.js';
import { readRetention } from '../retention.js';

type Context = Pick<ApiTrace, 'conversationId' | 'turnId' | 'messageId' | 'providerId' | 'providerName' | 'purpose'>;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Body bytes and row count currently held by the request log. */
export function readTraceStats(): { count: number; bytes: number; conversations: number } {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(body_bytes), 0) AS bytes, COUNT(DISTINCT conversation_id) AS conversations FROM api_traces')
    .get() as { n: number; bytes: number; conversations: number };
  return { count: row.n, bytes: row.bytes, conversations: row.conversations };
}

export const apiTracesRepo = {
  interruptPending() {
    getDb().exec(`UPDATE api_traces SET data_json = json_set(data_json, '$.status', 'interrupted',
      '$.error', '服务重启，未收到请求结束记录') WHERE json_extract(data_json, '$.status') = 'running'`);
  },
  sink(context: Context): TraceSink {
    return record => this.save({ ...record, ...context });
  },
  save(record: ApiTraceDetail) {
    const db = getDb();
    const { requestBody, requestHeaders, responseBody, responseHeaders, ...summary } = record;
    let body = JSON.stringify({ requestBody, requestHeaders, responseBody, responseHeaders });
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      summary.bodyAvailable = false;
      summary.notes.push('请求与响应正文超过 16 MiB，未保留正文');
      body = JSON.stringify({ requestBody: null, requestHeaders, responseBody: null, responseHeaders });
    }
    db.prepare(`INSERT INTO api_traces(id,conversation_id,turn_id,message_id,started_at,data_json,body_json,body_bytes)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, body_json=excluded.body_json, body_bytes=excluded.body_bytes`)
      .run(record.id, record.conversationId, record.turnId, record.messageId, record.startedAt, JSON.stringify(summary), body, Buffer.byteLength(body));
    // Insert-time guard: hold the log near the configured ceilings so one long generation cannot
    // grow the file without bound between prunes. Rows belonging to a running conversation are
    // kept even when they exceed the limit — the prune pass owns that decision.
    const retention = readRetention();
    if (retention.autoPrune) {
      const maxCount = Math.floor(Math.max(0, retention.maxCount));
      const maxBytes = Math.floor(Math.max(0, retention.maxTotalBytes));
      db.exec(`DELETE FROM api_traces WHERE conversation_id NOT IN (
          SELECT DISTINCT conversation_id FROM api_traces
          WHERE json_extract(data_json, '$.status') = 'running'
        ) AND id IN (
          SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY started_at DESC, rowid DESC) AS n,
            SUM(body_bytes) OVER (ORDER BY started_at DESC, rowid DESC) AS bytes FROM api_traces)
          WHERE n > ${maxCount} OR bytes > ${maxBytes})`);
    }
  },
  /** Every attempt in a conversation ordered by time; narrow to one user turn with turnId. */
  list(conversationId: string, turnId?: string): ApiTrace[] {
    const rows = turnId
      ? getDb().prepare('SELECT data_json FROM api_traces WHERE conversation_id=? AND turn_id=? ORDER BY started_at, rowid').all(conversationId, turnId)
      : getDb().prepare('SELECT data_json FROM api_traces WHERE conversation_id=? ORDER BY started_at, rowid').all(conversationId);
    return (rows as { data_json: string }[]).map(row => JSON.parse(row.data_json) as ApiTrace);
  },
  get(conversationId: string, id: string): ApiTraceDetail | null {
    const row = getDb().prepare('SELECT data_json,body_json FROM api_traces WHERE conversation_id=? AND id=?').get(conversationId, id) as { data_json: string; body_json: string } | undefined;
    if (!row) return null;
    const body = JSON.parse(row.body_json) as Partial<Pick<ApiTraceDetail, 'requestBody' | 'requestHeaders' | 'responseBody' | 'responseHeaders'>>;
    return { requestBody: null, requestHeaders: {}, responseBody: null, responseHeaders: {}, ...JSON.parse(row.data_json), ...body } as ApiTraceDetail;
  },
};
