import type { ApiTrace, ApiTraceDetail } from '@aichat/shared';
import { getDb } from '../database.js';
import type { TraceSink } from '../../llm/trace.js';

type Context = Pick<ApiTrace, 'conversationId' | 'turnId' | 'messageId' | 'providerId' | 'providerName' | 'purpose'>;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

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
    // Keep the newest evidence within both a count and payload budget.
    db.exec(`DELETE FROM api_traces WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY rowid DESC) AS n,
        SUM(body_bytes) OVER (ORDER BY rowid DESC) AS bytes FROM api_traces)
      WHERE n > 500 OR bytes > ${MAX_BYTES})`);
  },
  /** Every attempt in a conversation, oldest first; narrow to one user turn with turnId. */
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
