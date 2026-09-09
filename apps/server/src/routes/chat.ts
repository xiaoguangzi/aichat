import { Hono } from 'hono';
import type { Block } from '@aichat/shared';
import { sendMessageSchema } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { activeRuns, BackgroundRun } from '../agent/runs.js';
import { resolveApproval } from '../agent/approvals.js';
import { expandSlash } from '../skills/slash.js';
import { attachmentToBlocks } from '../util/attachments.js';
import { streamRun } from '../util/sse.js';
import { notFound, badRequest } from '../util/errors.js';

export const chatRoute = new Hono();

chatRoute.post('/conversations/:id/messages', async (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  const input = sendMessageSchema.parse(await c.req.json());
  // Check after reading the body so concurrent requests cannot both pass the guard.
  if (activeRuns.has(conv.id)) throw badRequest('A response is already in progress for this conversation.');

  // Build the user message (unless regenerating)
  let userText = input.text;
  if (input.editMessageId) {
    const m = messagesRepo.get(input.editMessageId);
    if (!m || m.conversationId !== conv.id) throw notFound('message');
    messagesRepo.deleteFrom(conv.id, m.seq);
  }
  if (input.regenerate) {
    const msgs = messagesRepo.list(conv.id);
    // drop trailing assistant/tool-result messages back to the last real user message
    let i = msgs.length - 1;
    while (i >= 0 && !(msgs[i]!.role === 'user' && msgs[i]!.content.some((b) => b.type !== 'tool_result'))) i--;
    if (i < 0) throw badRequest('Nothing to regenerate');
    if (i < msgs.length - 1) messagesRepo.deleteFrom(conv.id, msgs[i + 1]!.seq);
    userText = msgs[i]!.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
  } else {
    if (!input.text.trim() && !input.attachmentIds?.length) throw badRequest('Empty message');
    const blocks: Block[] = [];
    for (const id of input.attachmentIds ?? []) {
      const att = attachmentsRepo.get(id);
      if (att) blocks.push(...attachmentToBlocks(att));
    }
    const { blocks: textBlocks } = expandSlash(input.text);
    blocks.push(...textBlocks);
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: blocks });
  }

  const isFirst = messagesRepo.list(conv.id).filter((m) => m.role === 'assistant').length === 0;
  const run = new BackgroundRun(conversationsRepo.get(conv.id)!, userText, isFirst);
  return streamRun(c, conv.id, run);
});

chatRoute.get('/conversations/:id/events', (c) => {
  const id = c.req.param('id');
  if (!conversationsRepo.get(id)) throw notFound('conversation');
  return streamRun(c, id, activeRuns.get(id));
});

chatRoute.post('/conversations/:id/stop', (c) => {
  const run = activeRuns.get(c.req.param('id'));
  run?.abort.abort();
  return c.json({ ok: !!run });
});

chatRoute.get('/conversations/:id/status', (c) => c.json({ running: activeRuns.has(c.req.param('id')) }));

chatRoute.post('/approvals/:id', async (c) => {
  const body = (await c.req.json()) as { approve: boolean };
  const ok = resolveApproval(c.req.param('id'), !!body.approve);
  if (!ok) throw notFound('approval request');
  for (const run of activeRuns.values()) run.resolveApproval(c.req.param('id'));
  return c.json({ ok: true });
});
