import { Hono } from 'hono';
import { apiTracesRepo } from '../db/repos/apiTraces.js';
import { requestDiagnosticsRepo } from '../db/repos/requestDiagnostics.js';
import { artifactEditSchema, collectArtifacts, conversationInputSchema } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { modelsRepo } from '../db/repos/providers.js';
import { badRequest, notFound } from '../util/errors.js';
import { activeRuns } from '../agent/runs.js';

import { artifactsRepo } from '../db/repos/artifacts.js';

export const conversationsRoute = new Hono();

conversationsRoute.get('/', (c) =>
  c.json(conversationsRepo.list(c.req.query('q') || undefined, c.req.query('groupId') || undefined)),
);

conversationsRoute.post('/', async (c) => {
  const input = conversationInputSchema.parse(await c.req.json().catch(() => ({})));
  let modelId = input.modelId ?? null;
  let providerId = input.providerId ?? null;
  if (!modelId) {
    const def = modelsRepo.getDefault();
    if (def) {
      modelId = def.id;
      providerId = def.providerId;
    }
  } else if (!providerId) {
    providerId = modelsRepo.get(modelId)?.providerId ?? null;
  }
  const conv = conversationsRepo.create({ ...input, modelId, providerId });
  return c.json(conv, 201);
});

conversationsRoute.get('/:id', (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  return c.json({ ...conv, messages: messagesRepo.list(conv.id), running: activeRuns.has(conv.id) });
});

conversationsRoute.put('/:id', async (c) => {
  const input = conversationInputSchema.parse(await c.req.json());
  const patch = { ...input } as typeof input & { providerId?: string | null };
  if (input.modelId) patch.providerId = modelsRepo.get(input.modelId)?.providerId ?? null;
  const conv = conversationsRepo.update(c.req.param('id'), patch);
  if (!conv) throw notFound('conversation');
  return c.json(conv);
});

conversationsRoute.delete('/:id', async (c) => {
  const run = activeRuns.get(c.req.param('id'));
  if (run) {
    run.abort.abort();
    await run.task;
  }
  if (!conversationsRepo.delete(c.req.param('id'))) throw notFound('conversation');
  return c.json({ ok: true });
});

conversationsRoute.delete('/:id/messages/:mid', (c) => {
  const m = messagesRepo.get(c.req.param('mid'));
  if (!m || m.conversationId !== c.req.param('id')) throw notFound('message');
  if (activeRuns.has(m.conversationId)) throw badRequest('Stop the response before deleting messages.');
  messagesRepo.deleteFrom(m.conversationId, m.seq);
  return c.json({ ok: true });
});

conversationsRoute.get('/:id/export', (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  const lines: string[] = [`# ${conv.title || 'Chat'}`, ''];
  for (const m of messagesRepo.list(conv.id)) {
    const who = m.role === 'user' ? 'User' : 'Assistant';
    const parts: string[] = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text);
      else if (b.type === 'thinking' && b.thinking) parts.push(`<details><summary>Thinking</summary>\n\n${b.thinking}\n\n</details>`);
      else if (b.type === 'tool_use') parts.push(`**Tool call** \`${b.name}\`\n\n\`\`\`json\n${JSON.stringify(b.input, null, 2)}\n\`\`\``);
      else if (b.type === 'tool_result') parts.push(`**Tool result**\n\n\`\`\`\n${b.content.map((x) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n')}\n\`\`\``);
      else if (b.type === 'image') parts.push(`![image](${b.attachmentId ? `/api/uploads/${b.attachmentId}` : 'inline'})`);
      else if (b.type === 'document') parts.push(`[attachment: ${b.name}]`);
    }
    if (parts.length) lines.push(`## ${who}`, '', ...parts, '');
  }
  return c.text(lines.join('\n'), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

conversationsRoute.get('/:id/artifacts', (c) => {
  if (!conversationsRepo.get(c.req.param('id'))) throw notFound('conversation');
  return c.json(artifactsRepo.list(c.req.param('id')));
});

conversationsRoute.post('/:id/artifacts', async (c) => {
  const input = artifactEditSchema.parse(await c.req.json());
  const message = messagesRepo.get(input.messageId);
  if (!message || message.conversationId !== c.req.param('id') ||
      !collectArtifacts([message]).some(a => a.id === input.artifactId && a.complete)) throw notFound('artifact');
  return c.json(artifactsRepo.create(message.conversationId, input), 201);
});

const isTurn = (m: { role: string; content: { type: string }[] }) => m.role === 'user' && m.content.some(b => b.type !== 'tool_result');

/** Request log for a conversation (or one user turn). Older diagnostics rows fill in gaps without bodies. */
conversationsRoute.get('/:id/traces', (c) => {
  const conversationId = c.req.param('id');
  if (!conversationsRepo.get(conversationId)) throw notFound('conversation');
  const turnId = c.req.query('turnId') || undefined;
  const messages = messagesRepo.list(conversationId);
  // Every message belongs to the user turn that started its loop; title requests hang off the first turn.
  const turnOf = new Map<string, string>();
  let turn: string | undefined;
  for (const m of messages) {
    if (isTurn(m)) turn = m.id;
    if (turn) turnOf.set(m.id, turn);
  }
  const firstTurn = messages.find(isTurn)?.id;
  if (firstTurn) turnOf.set(`${conversationId}:title`, firstTurn);
  if (turnId && ![...turnOf.values()].includes(turnId)) throw notFound('turn');
  const records = apiTracesRepo.list(conversationId, turnId);
  const captured = new Set(records.map(r => r.messageId));
  // Older metadata remains useful, but never pretend its hashes are request bodies.
  for (const row of requestDiagnosticsRepo.list(conversationId)) {
    const owner = turnOf.get(row.messageId);
    if (!owner || (turnId && owner !== turnId) || captured.has(row.messageId)) continue;
    records.push({
      ...row.data, id: `legacy-${row.id}`, conversationId, turnId: owner, messageId: row.messageId,
      providerId: row.providerId, providerName: '', purpose: row.messageId.endsWith(':title') ? 'title' : 'chat',
      attempt: 1, method: '', url: '', bodyAvailable: false,
      notes: ['仅保留历史诊断摘要；未采集或已清理请求正文，无法还原完整 JSON'],
    });
  }
  records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return c.json(records.map(record => record.status === 'running' && !activeRuns.has(conversationId)
    ? { ...record, status: 'interrupted', notes: [...record.notes, '运行已结束或服务已重启，未收到请求结束记录'] } : record));
});

conversationsRoute.get('/:id/traces/:traceId', (c) => {
  const record = apiTracesRepo.get(c.req.param('id'), c.req.param('traceId'));
  if (!record) throw notFound('API trace');
  return c.json(record);
});
