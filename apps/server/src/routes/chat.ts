import { Hono } from 'hono';
import type { Block } from '@aichat/shared';
import { approvalDecisionSchema, sendMessageSchema } from '@aichat/shared';
import { conversationsRepo } from '../db/repos/conversations.js';
import { messagesRepo } from '../db/repos/messages.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { activeRuns, BackgroundRun } from '../agent/runs.js';
import { pendingToolOf, readApprovalRules, rememberApproval, forgetApproval, resolveApproval } from '../agent/approvals.js';
import { expandSlash } from '../skills/slash.js';
import { attachmentToBlocks } from '../util/attachments.js';
import { streamRun } from '../util/sse.js';
import { notFound, badRequest } from '../util/errors.js';

export const chatRoute = new Hono();

/** Remembered approval rules: list and remove them (the decision itself is remembered in the banner). */
chatRoute.get('/approvals/rules', (c) => c.json(readApprovalRules()));
chatRoute.delete('/approvals/rules/:tool', (c) => {
  forgetApproval(c.req.param('tool'));
  return c.json({ ok: true });
});

chatRoute.post('/conversations/:id/messages', async (c) => {
  const conv = conversationsRepo.get(c.req.param('id'));
  if (!conv) throw notFound('conversation');
  const input = sendMessageSchema.parse(await c.req.json());
  // Check after reading the body so concurrent requests cannot both pass the guard.
  if (activeRuns.has(conv.id)) throw badRequest('A response is already in progress for this conversation.');

  // Build the user message (unless regenerating)
  let userText = input.text;
  const visible = () => messagesRepo.list(conv.id, conversationsRepo.get(conv.id)?.activeBranch ?? []);
  /**
   * Set when this request replaces an answer. The previous variant is kept, so ‹ n/m › can bring it
   * back; the server both attaches the new reply here and switches the view to it after the run.
   */
  let branchPoint: string | null | undefined;
  /** Where the reply must attach. Regenerating puts it beside the previous answer, not after it. */
  let attachTo: string | null | undefined;

  if (input.editMessageId) {
    const original = messagesRepo.get(input.editMessageId);
    if (!original || original.conversationId !== conv.id) throw notFound('message');
    // Only the newest *question* can be revised in place. Editing an older one starts a new turn
    // from there, which necessarily drops the messages that followed it on this branch.
    const all = messagesRepo.listAll(conv.id);
    const lastQuestion = [...all].reverse().find((m) => m.role === 'user' && m.content.some((b) => b.type !== 'tool_result'));
    const isTip = lastQuestion?.id === original.id;
    if (isTip) {
      const blocks: Block[] = [];
      for (const id of input.attachmentIds ?? []) {
        const att = attachmentsRepo.get(id);
        if (att) blocks.push(...attachmentToBlocks(att));
      }
      const { blocks: textBlocks } = expandSlash(input.text);
      blocks.push(...textBlocks);
      const forked = messagesRepo.fork(original.id, blocks.length ? blocks : original.content);
      if (!forked) throw notFound('message');
      // The fork's id is only known here; the run resolves it to the flipped question after it has
      // persisted the new answer, so the derived path lands on the new variant.
      branchPoint = forked.id;
    } else {
      messagesRepo.deleteFrom(conv.id, original.seq);
      const blocks: Block[] = [];
      for (const id of input.attachmentIds ?? []) {
        const att = attachmentsRepo.get(id);
        if (att) blocks.push(...attachmentToBlocks(att));
      }
      const { blocks: textBlocks } = expandSlash(input.text);
      blocks.push(...textBlocks);
      messagesRepo.create({ conversationId: conv.id, role: 'user', content: blocks, parentId: original.parentId });
    }
  } else if (input.continueFromId) {
    // Continuing is not a new variant: the reply continues the same message, so the run attaches to
    // it directly and no sibling is created.
    const source = messagesRepo.get(input.continueFromId);
    if (!source || source.conversationId !== conv.id) throw notFound('message');
    if (source.role !== 'assistant') throw badRequest('只能从回答继续。');
    userText = '';
    attachTo = source.id;
  } else if (input.regenerate) {
    const msgs = visible();
    // Answer again at the last question: the new reply becomes a sibling of the previous one.
    let i = msgs.length - 1;
    while (i >= 0 && !(msgs[i]!.role === 'user' && msgs[i]!.content.some((b) => b.type !== 'tool_result'))) i--;
    if (i < 0) throw badRequest('Nothing to regenerate');
    const question = msgs[i]!;
    // The new reply is created by the run itself, as the newest child of the same question, so the
    // branch walk lands on it while the previous answer stays as a sibling. Switching the view to
    // the question is enough; no row has to be copied here.
    // The reply is created by the run as the newest child of the question, so the branch walk lands
    // on it while the previous answer stays a sibling. No row has to be copied here.
    if (msgs[i + 1]) branchPoint = question.id;
    attachTo = question.id;
    userText = question.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
  } else {
    if (!input.text.trim() && !input.attachmentIds?.length) throw badRequest('Empty message');
    const blocks: Block[] = [];
    for (const id of input.attachmentIds ?? []) {
      const att = attachmentsRepo.get(id);
      if (att) blocks.push(...attachmentToBlocks(att));
    }
    const { blocks: textBlocks } = expandSlash(input.text);
    blocks.push(...textBlocks);
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: blocks, parentId: visible().at(-1)?.id ?? null });
  }

  // "First" means the conversation has never been answered on any branch: that decides whether a
  // title still has to be generated, which is a property of the conversation, not of this view.
  const isFirst = messagesRepo.listAll(conv.id).filter((m) => m.role === 'assistant').length === 0;
  // The branch is switched after the run persists its reply, so the derived path includes it.
  const run = new BackgroundRun(conversationsRepo.get(conv.id)!, userText, isFirst, branchPoint, attachTo);
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
  const body = approvalDecisionSchema.parse(await c.req.json());
  const pendingTool = pendingToolOf(c.req.param('id'));
  const ok = resolveApproval(c.req.param('id'), body.approve);
  if (!ok) throw notFound('approval request');
  // Recorded after the decision is delivered, so a settings write can never delay the run.
  if (body.remember && pendingTool) rememberApproval(pendingTool, body.approve);
  for (const run of activeRuns.values()) run.resolveApproval(c.req.param('id'));
  return c.json({ ok: true, remembered: body.remember && pendingTool ? pendingTool : null });
});
