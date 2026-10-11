import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent } from '@aichat/shared';

// vi.mock factories hoist above imports, so config.ts must not be trusted to pick up DATA_DIR.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-branch-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

/** Answers are labelled with the call number so a variant is identifiable in assertions. */
let call = 0;
vi.mock('../src/llm/registry.js', () => ({
  evictAdapter: () => {},
  getAdapter: () => ({
    type: 'openai',
    listModels: async () => [],
    async *stream(): AsyncIterable<StreamEvent> {
      call += 1;
      yield { type: 'text_delta', text: `answer-${call}` };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  }),
}));
vi.mock('../src/mcp/manager.js', () => ({ mcpManager: { toolDefs: () => [] } }));
vi.mock('../src/skills/tools.js', () => ({ skillToolDefs: () => [] }));
vi.mock('../src/agent/title.js', () => ({ generateTitle: async () => null }));

const { initDb, closeDb } = await import('../src/db/database.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { createApp } = await import('../src/app.js');
const { activeRuns, stopAllRuns } = await import('../src/agent/runs.js');

beforeEach(() => {
  call = 0;
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`));
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  modelsRepo.upsert(provider.id, { modelId: 'gpt', isDefault: true });
});
afterEach(async () => {
  await stopAllRuns();
  closeDb();
});

const app = () => createApp();
const json = { 'Content-Type': 'application/json' };
const post = (url: string, body: unknown) => app().request(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
const get = (url: string) => app().request(url);

async function newConversation(): Promise<string> {
  const res = await post('/api/conversations', {});
  return ((await res.json()) as { id: string }).id;
}

/**
 * The SSE response ends when the browser-facing stream closes, which is not necessarily when the
 * background run has persisted its last row. Awaiting the run's own task is what makes the
 * assertions below deterministic.
 */
const send = async (id: string, body: unknown) => {
  const res = await post(`/api/conversations/${id}/messages`, body);
  await res.text();
  expect(res.status).toBe(200);
  // The stream ends when the client-facing queue closes; the background run may still be writing.
  await vi.waitFor(() => expect(activeRuns.has(id)).toBe(false), { timeout: 5_000 });
};

const view = async (id: string) => {
  const res = await get(`/api/conversations/${id}`);
  return (await res.json()) as {
    activeBranch: string[];
    messages: Array<{ id: string; role: string; parentId: string | null; content: Array<{ type: string; text?: string }>; variants?: { index: number; total: number } }>;
  };
};

const textOf = (m: { content: Array<{ type: string; text?: string }> }) =>
  m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

it('keeps the previous answer as a variant when regenerating', async () => {
  const id = await newConversation();
  await send(id, { text: 'question' });
  await send(id, { text: '', regenerate: true });

  const { messages } = await view(id);
  expect(messages.map((m) => `${m.role}:${textOf(m)}`)).toEqual(['user:question', 'assistant:answer-2']);
  // Both answers still exist, sharing the same parent, and the view is on the newer one.
  const answers = messagesRepo.childrenOf(id, messages[0]!.id);
  expect(answers.map(textOf)).toEqual(['answer-1', 'answer-2']);
  expect(messages.at(-1)!.variants).toMatchObject({ index: 2, total: 2 });

  // Switching back shows the first answer without creating a copy.
  const switched = await post(`/api/conversations/${id}/branch`, { messageId: answers[0]!.id });
  const after = (await switched.json()) as { messages: Array<{ variants?: { index: number; total: number } }> };
  expect(after.messages.at(-1)!.variants).toMatchObject({ index: 1, total: 2 });
  expect((await view(id)).messages.map(textOf)).toEqual(['question', 'answer-1']);
  expect(messagesRepo.listAll(id)).toHaveLength(3);
});

it('adds an edited question as a variant when it is the last one', async () => {
  const id = await newConversation();
  await send(id, { text: 'first wording' });
  const before = await view(id);
  const question = before.messages[0]!;

  await send(id, { text: 'better wording', editMessageId: question.id });

  const { messages } = await view(id);
  expect(messages.map((m) => `${m.role}:${textOf(m)}`)).toEqual(['user:better wording', 'assistant:answer-2']);
  // The original question is still reachable as a sibling at the same position.
  expect(messages[0]!.variants).toMatchObject({ index: 2, total: 2 });
  const questions = messagesRepo.childrenOf(id, null);
  expect(questions.map(textOf)).toEqual(['first wording', 'better wording']);
  // The old answer stays attached to the old question, untouched.
  expect(messagesRepo.childrenOf(id, questions[0]!.id).map(textOf)).toEqual(['answer-1']);
});

it('starts a new turn when editing a question that is not the last one', async () => {
  const id = await newConversation();
  await send(id, { text: 'q1' });
  await send(id, { text: 'q2' });
  const before = await view(id);
  const q2 = before.messages.find((m) => textOf(m) === 'q2')!;
  expect(q2).toBeTruthy();

  // Editing the older question drops what followed it on this branch: the follow-up "q2" no longer
  // has a question it can hang off.
  await send(id, { text: 'q1 revised', editMessageId: before.messages[0]!.id });
  const { messages } = await view(id);
  expect(messages.map(textOf)).toEqual(['q1 revised', 'answer-3']);
});

it('links each new row to its parent so the shape stays a tree', async () => {
  const id = await newConversation();
  await send(id, { text: 'hello' });
  const { messages } = await view(id);
  expect(messages[0]!.parentId).toBeNull();
  expect(messages[1]!.parentId).toBe(messages[0]!.id);
});

it('walks down through the newest child when only an earlier variant is selected', async () => {
  const id = await newConversation();
  await send(id, { text: 'q' });
  await send(id, { text: '', regenerate: true });
  const first = messagesRepo.childrenOf(id, (await view(id)).messages[0]!.id)[0]!;

  await post(`/api/conversations/${id}/branch`, { messageId: first.id });
  await send(id, { text: 'follow-up' });

  // The follow-up attaches under the branch being viewed, so one walk shows a consistent story.
  const { messages } = await view(id);
  expect(messages.map(textOf)).toEqual(['q', 'answer-1', 'follow-up', 'answer-3']);
  expect(messages.at(-2)!.parentId).toBe(first.id);
  // The other answer is still stored, just not on this path.
  expect(messagesRepo.listAll(id)).toHaveLength(5);
});

it('prunes rows whose branch was deleted', async () => {
  const id = await newConversation();
  await send(id, { text: 'q' });
  await send(id, { text: '', regenerate: true });
  const answers = messagesRepo.childrenOf(id, (await view(id)).messages[0]!.id);
  expect(answers).toHaveLength(2);

  messagesRepo.delete(answers[1]!.id);
  // The deleted answer has no children, so nothing else goes with it.
  expect(messagesRepo.listAll(id)).toHaveLength(2);
});

it('deletes descendants of a removed message instead of leaving them unreachable', async () => {
  const id = await newConversation();
  await send(id, { text: 'q' });
  const question = (await view(id)).messages[0]!;

  const removed = messagesRepo.pruneOrphans(id);
  expect(removed).toBe(0);
  messagesRepo.delete(question.id);
  // Both the answer and the parentless question are gone: the conversation is empty, not orphaned.
  expect(messagesRepo.listAll(id)).toHaveLength(0);
});

it('refuses to switch variants while a response is still generating', async () => {
  const id = await newConversation();
  await send(id, { text: 'q' });
  const messages = (await view(id)).messages;
  activeRuns.set(id, { abort: new AbortController() } as never);
  try {
    const res = await post(`/api/conversations/${id}/branch`, { messageId: messages[0]!.id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('停止生成');
  } finally {
    activeRuns.delete(id);
  }
});
