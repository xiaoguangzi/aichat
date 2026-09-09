import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSSEEvent, StreamEvent } from '@aichat/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-reclass-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

// A model whose chat template opened <think> itself: the reasoning arrives as plain text and
// only the closing tag reveals it, which the splitter turns into thinking_reclassify.
vi.mock('../src/llm/registry.js', () => ({
  getAdapter: () => ({
    type: 'openai',
    listModels: async () => [],
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', text: 'weighing the options' };
      yield { type: 'thinking_reclassify' };
      yield { type: 'text_delta', text: 'The answer.' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  }),
  evictAdapter: () => {},
}));
vi.mock('../src/mcp/manager.js', () => ({ mcpManager: { toolDefs: () => [], callTool: async () => ({ content: [], isError: false }) } }));

const { initDb, closeDb } = await import('../src/db/database.js');
const { ensureDirs } = await import('../src/config.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { runAgent } = await import('../src/agent/loop.js');

beforeEach(() => {
  ensureDirs();
  initDb(path.join(tmp, `t-${Date.now()}.db`));
});
afterEach(() => closeDb());

describe('leaked reasoning', () => {
  it('is persisted as a thinking block and forwarded to the browser', async () => {
    const p = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
    const m = modelsRepo.upsert(p.id, { modelId: 'deepseek-test' });
    const conv = conversationsRepo.create({ providerId: p.id, modelId: m.id });
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'why?' }] });

    const events: ChatSSEEvent[] = [];
    await runAgent({ conversation: conversationsRepo.get(conv.id)!, signal: new AbortController().signal, emit: (e) => void events.push(e) });

    expect(events.map((e) => e.event)).toContain('thinking_reclassify');
    const msgs = messagesRepo.list(conv.id);
    expect(msgs[1]!.content).toEqual([
      { type: 'thinking', thinking: 'weighing the options' },
      { type: 'text', text: 'The answer.' },
    ]);
  });
});
