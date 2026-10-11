import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Block, ChatSSEEvent, StreamEvent } from '@aichat/shared';

/** Every request the loop sent, so the retry can be compared against the original payload. */
const calls: Array<{ messages: Array<{ role: string; content: Block[] }> }> = [];
/** Reject only the first call; later calls answer, so the mock cannot depend on the call count. */
let rejectFirst = true;
/** Reject every call, to observe what happens when the squeeze is still not enough. */
let rejectAlways = false;
/** Set to make the error look like a parameter problem instead of an over-long history. */
let rejectMessage = "This model's maximum context length is 8000 tokens, however you requested 12000 tokens";

vi.mock('../src/llm/registry.js', () => ({
  evictAdapter: () => {},
  getAdapter: () => ({
    type: 'openai',
    listModels: async () => [],
    async *stream(req: { messages: Array<{ role: string; content: Block[] }> }): AsyncIterable<StreamEvent> {
      calls.push({ messages: structuredClone(req.messages) });
      if (rejectAlways || rejectFirst) {
        rejectFirst = false;
        throw new Error(rejectMessage);
      }
      yield { type: 'text_delta', text: 'recovered' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  }),
}));
vi.mock('../src/mcp/manager.js', () => ({ mcpManager: { toolDefs: () => [] } }));
vi.mock('../src/skills/tools.js', () => ({ skillToolDefs: () => [] }));

// vi.mock factories hoist above the imports, so config.ts may already have been loaded with the
// developer's real DATA_DIR by the time this line runs. Point the database at a temp file
// explicitly instead of relying on the environment.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-overflow-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

const { initDb, closeDb } = await import('../src/db/database.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { runAgent } = await import('../src/agent/loop.js');

beforeEach(() => {
  calls.length = 0;
  rejectFirst = true;
  rejectAlways = false;
  rejectMessage = "This model's maximum context length is 8000 tokens, however you requested 12000 tokens";
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random().toString(16).slice(2)}.db`));
});
afterEach(() => closeDb());

/** An old turn with a fat tool result, plus the current user question. */
function conversationWithHistory() {
  const provider = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
  const model = modelsRepo.upsert(provider.id, { modelId: 'gpt', contextWindow: 8_000 });
  const conv = conversationsRepo.create({ providerId: provider.id, modelId: model.id });
  messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'old question' }] });
  messagesRepo.create({
    conversationId: conv.id, role: 'assistant',
    content: [{ type: 'text', text: 'answer' }, { type: 'tool_use', id: 't1', name: 'echo', input: {} }],
  });
  messagesRepo.create({
    conversationId: conv.id, role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'FAT_' + 'x'.repeat(4_000) + '_TAIL' }] }],
  });
  messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: [{ type: 'text', text: 'done' }] });
  messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'new question' }] });
  return { conv: conversationsRepo.get(conv.id)!, model };
}

const run = async (conv: ReturnType<typeof conversationWithHistory>['conv']) => {
  const events: ChatSSEEvent[] = [];
  const estimates: unknown[] = [];
  await runAgent({ conversation: conv, signal: new AbortController().signal, emit: (e) => void events.push(e), onContext: (c) => void estimates.push(c) });
  return { events, estimates };
};

it('squeezes old tool results and retries once after a context-overflow rejection', async () => {
  const { conv } = conversationWithHistory();
  const { events } = await run(conv);

  expect(calls).toHaveLength(2);
  // The first attempt carried the whole tool result; the retry keeps only a short head of it.
  const first = JSON.stringify(calls[0]!.messages);
  const second = JSON.stringify(calls[1]!.messages);
  expect(first).toContain('_TAIL');
  expect(second).not.toContain('_TAIL');
  expect(second).toContain('Old tool result cleared from context');
  expect(second.length).toBeLessThan(first.length / 2);
  // Prose survives the squeeze: the conversation still reads correctly.
  expect(JSON.stringify(calls[1]!.messages)).toContain('old question');
  expect(JSON.stringify(calls[1]!.messages)).toContain('new question');
  // Only the successful attempt is persisted: no extra error message from the rejected try.
  const assistant = messagesRepo.list(conv.id).filter(m => m.role === 'assistant');
  expect(assistant.at(-1)!.content).toEqual([{ type: 'text', text: 'recovered' }]);
  expect(assistant.at(-1)!.stopReason).toBe('end_turn');
  expect(assistant.some(m => m.stopReason === 'error')).toBe(false);
  expect(events.filter(e => e.event === 'error')).toEqual([]);
  expect(events.filter(e => e.event === 'message_start').length).toBe(2);
});

it('leaves a parameter error alone instead of squeezing history for it', async () => {
  rejectMessage = 'max_tokens is too large: 200000. This model supports at most 64000 completion tokens';
  const { conv } = conversationWithHistory();
  const { events } = await run(conv);

  // No retry: the payload could not have succeeded, and rewriting history would have been silent.
  expect(calls).toHaveLength(1);
  expect(JSON.stringify(calls[0]!.messages)).toContain('_TAIL');
  const error = events.find(e => e.event === 'error');
  expect(error?.data).toMatchObject({ code: 'internal' });
  expect(messagesRepo.list(conv.id).filter(m => m.role === 'assistant').at(-1)!.stopReason).toBe('error');
});

it('reports a specific error when the squeeze still does not fit', async () => {
  rejectAlways = true;
  const { conv } = conversationWithHistory();
  const { events } = await run(conv);

  // Exactly one retry, never a loop that keeps charging the provider.
  expect(calls).toHaveLength(2);
  const error = events.find(e => e.event === 'error');
  expect(error?.data).toMatchObject({ code: 'context_overflow' });
  expect(String(error?.data.message)).toContain('减少附件');
  const assistant = messagesRepo.list(conv.id).filter(m => m.role === 'assistant');
  expect(assistant.at(-1)!.stopReason).toBe('error');
});

it('reports the payload size for every attempt it sends', async () => {
  const { conv } = conversationWithHistory();
  const { estimates } = await run(conv);

  expect(estimates).toHaveLength(2);
  const [first, second] = estimates as Array<{ history: number; budget: number | null; ratio: number | null }>;
  expect(first!.budget).toBe(8_000);
  expect(first!.ratio).toBeGreaterThan(0);
  // The retry is smaller, which is the whole point of squeezing.
  expect(second!.history).toBeLessThan(first!.history);
});
