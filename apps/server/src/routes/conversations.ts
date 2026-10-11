import { Hono } from 'hono';
import { apiTracesRepo } from '../db/repos/apiTraces.js';
import { requestDiagnosticsRepo } from '../db/repos/requestDiagnostics.js';
import { artifactEditSchema, collectArtifacts, conversationInputSchema, switchBranchSchema } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { modelsRepo } from '../db/repos/providers.js';
import { badRequest, notFound } from '../util/errors.js';
import { activeRuns } from '../agent/runs.js';
import { contextEstimateFor } from '../agent/loop.js';
import { branchPathFor, showCurrent } from '../agent/branches.js';
import type { Message } from '@aichat/shared';
import { readRoutingSettings } from '../decisions/routing.js';
import { groupsRepo } from '../db/repos/groups.js';

import { artifactsRepo } from '../db/repos/artifacts.js';

export const conversationsRoute = new Hono();

conversationsRoute.get('/', (c) =>
  c.json(conversationsRepo.list(c.req.query('q') || undefined, c.req.query('groupId') || undefined)),
);

conversationsRoute.post('/', async (c) => {
  const input = conversationInputSchema.parse(await c.req.json().catch(() => ({})));
  // A conversation created inside a project inherits its defaults. An explicit request field always
  // wins, so the picker's current choice is never silently overridden by the project.
  const project = input.groupId ? groupsRepo.get(input.groupId) : null;
  let modelId = input.modelId ?? project?.modelId ?? null;
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
  const conv = conversationsRepo.create({ ...input, modelId, providerId,
    settings: {
      ...project?.settings,
      ...input.settings,
      autoRoute: input.settings?.autoRoute ?? readRoutingSettings().enabled,
    },
  });
  return c.json(conv, 201);
});

conversationsRoute.get('/:id', async (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  const run = activeRuns.get(conv.id);
  // Idle conversations get the meter on load; a running one reports the payload it actually sent.
  const context = run ? null : await contextEstimateFor(conv);
  return c.json({ ...conv, messages: showCurrent(conv), running: !!run, context });
});

conversationsRoute.post('/:id/branch', async (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  if (activeRuns.has(conv.id)) throw badRequest('请先停止生成再切换版本。');
  const { messageId } = switchBranchSchema.parse(await c.req.json());
  const target = messagesRepo.get(messageId);
  if (!target || target.conversationId !== conv.id) throw notFound('message');
  const updated = conversationsRepo.setActiveBranch(conv.id, branchPathFor(conv.id, messageId));
  return c.json({ ...updated!, messages: showCurrent(updated!) });
});

conversationsRoute.put('/:id', async (c) => {
  const input = conversationInputSchema.parse(await c.req.json());
  const existing = conversationsRepo.get(c.req.param('id'));
  if (!existing) throw notFound('conversation');
  const changed = <T,>(next: T | undefined, prev: T) => next !== undefined && next !== prev;
  const autoRouteChanged = changed(input.settings?.autoRoute, existing.settings.autoRoute);
  const changesSelection = autoRouteChanged || changed(input.modelId, existing.modelId) ||
    changed(input.providerId, existing.providerId) || changed(input.settings?.reasoning, existing.settings.reasoning);
  if (changesSelection && (existing.routing || activeRuns.has(existing.id))) throw badRequest('此会话的模型与 effort 已固定或正在生成，请新建会话更改');
  if (autoRouteChanged && messagesRepo.list(existing.id).length) throw badRequest('只能在第一条消息之前切换自动路由');
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

/**
 * Last removed batch per conversation, so an accidental "delete from here" can be taken back.
 * In memory on purpose: it is a short-lived safety net for a misclick, not a trash can, and an
 * undo that survived a restart would need its own storage and retention story.
 */
const lastDeleted = new Map<string, { rows: Message[]; at: number }>();
const UNDO_WINDOW_MS = 10 * 60_000;

conversationsRoute.delete('/:id/messages/:mid', (c) => {
  const m = messagesRepo.get(c.req.param('mid'));
  if (!m || m.conversationId !== c.req.param('id')) throw notFound('message');
  if (activeRuns.has(m.conversationId)) throw badRequest('Stop the response before deleting messages.');
  const doomed = messagesRepo.listAll(m.conversationId).filter((x) => x.seq >= m.seq);
  messagesRepo.deleteFrom(m.conversationId, m.seq);
  lastDeleted.set(m.conversationId, { rows: doomed, at: Date.now() });
  return c.json({ ok: true, deleted: doomed.length });
});

/** Take back the last message deletion in this conversation, if it is still recent. */
conversationsRoute.post('/:id/undo-delete', (c) => {
  const id = c.req.param('id');
  if (!conversationsRepo.get(id)) throw notFound('conversation');
  const entry = lastDeleted.get(id);
  if (!entry) throw badRequest('没有可撤销的删除。');
  if (Date.now() - entry.at > UNDO_WINDOW_MS) {
    lastDeleted.delete(id);
    throw badRequest('撤销窗口已过，无法恢复。');
  }
  for (const message of entry.rows) {
    messagesRepo.create({
      id: message.id, conversationId: message.conversationId, role: message.role, content: message.content,
      parentId: message.parentId, usage: message.usage, timing: message.timing, model: message.model ?? null,
      stopReason: message.stopReason,
    });
  }
  lastDeleted.delete(id);
  const conv = conversationsRepo.get(id)!;
  return c.json({ ...conv, messages: showCurrent(conv), restored: entry.rows.length });
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
  const messages = messagesRepo.list(conversationId, conversationsRepo.get(conversationId)?.activeBranch ?? []);
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
