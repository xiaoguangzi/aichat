import { DatabaseSync } from 'node:sqlite';
import { dbPath } from '../src/config.js';
import type { RequestDiagnostic } from '../src/llm/diagnostics.js';
import { anthropicUsage, openAIUsage } from '../src/llm/usage.js';

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='request_diagnostics'").get()) {
    console.log('尚无请求诊断表；启动新版服务后会自动创建。');
  } else {
    const conversationId = process.argv[2];
    const rows = db.prepare(`SELECT conversation_id, message_id, provider_id, data_json FROM request_diagnostics ${conversationId ? 'WHERE conversation_id=?' : ''} ORDER BY id DESC LIMIT 100`)
      .all(...(conversationId ? [conversationId] : [])).reverse() as Array<{ conversation_id: string; message_id: string; provider_id: string; data_json: string }>;
    const previous = new Map<string, RequestDiagnostic>();
    const output = rows.map(row => {
      const d = JSON.parse(row.data_json) as RequestDiagnostic;
      const title = row.message_id.endsWith(':title');
      const key = `${row.conversation_id}/${row.provider_id}/${d.model}/${title}`;
      const prev = previous.get(key);
      let common = 0;
      if (prev) while (common < prev.messageHashes.length && prev.messageHashes[common] === d.messageHashes[common]) common++;
      previous.set(key, d);
      const usage = d.rawUsage ? (d.protocol === 'openai' ? openAIUsage(d.rawUsage) : anthropicUsage(d.rawUsage)) : undefined;
      return {
        time: d.startedAt, conversation: row.conversation_id.slice(0, 8), task: title ? 'title' : 'chat', model: d.model,
        input: usage ? `${usage.inputTotalKnown ? '' : '≥'}${usage.input}` : '未报告', output: usage?.output ?? '未报告',
        cacheRead: usage?.cacheRead ?? '未报告', cacheWrite: usage?.cacheWrite ?? '未报告',
        prefix: prev ? `${common}/${prev.messageHashes.length}` : '-',
        system: prev ? prev.systemHash === d.systemHash ? '=' : 'changed' : '-',
        tools: prev ? prev.toolsHash === d.toolsHash ? '=' : 'changed' : '-',
        settings: prev ? prev.settingsHash === d.settingsHash ? '=' : 'changed' : '-',
        status: d.status, requestId: d.requestId ?? d.responseId ?? '-',
      };
    });
    if (output.length) console.table(output);
    else console.log('尚无请求诊断；正常聊天后会自动记录，无需额外付费探测。');
    console.log('prefix 为与该会话同供应商/模型上次请求相同的消息数/上次消息总数；相同消息前缀不保证上游缓存命中。≥ 为统计下限；未报告不等于零。');
  }
} finally { db.close(); }
