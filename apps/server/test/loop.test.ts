import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatSSEEvent, StreamEvent } from '@aichat/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

// Fake adapter: first call requests a tool, second call answers.
const calls: unknown[] = [];
let largeResult = false;
vi.mock('../src/llm/registry.js', () => ({
  getAdapter: () => ({
    type: 'openai',
    listModels: async () => [],
    async *stream(req: unknown): AsyncIterable<StreamEvent> {
      calls.push({ ...(req as object), messages: [...(req as { messages: unknown[] }).messages] });
      if (calls.length === 1) {
        yield { type: 'text_delta', text: 'let me check' };
        yield { type: 'tool_call_start', id: 't1', name: 'mcp__demo__echo' };
        yield { type: 'tool_call_end', id: 't1', input: { msg: 'hi' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else if (largeResult && calls.length === 2) {
        const messages = (req as { messages: Array<{ content: unknown }> }).messages;
        const id = /result_id: (result_[\w-]+)/.exec(JSON.stringify(messages))![1]!;
        yield { type: 'tool_call_start', id: 't2', name: 'context__read_result' };
        yield { type: 'tool_call_end', id: 't2', input: { result_id: id, query: 'TAIL_EVIDENCE' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'text_delta', text: 'done: ' };
        yield { type: 'text_delta', text: 'hi' };
        yield { type: 'usage', usage: { input: 10, output: 5 } };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  }),
  evictAdapter: () => {},
}));
vi.mock('../src/mcp/manager.js', () => ({
  mcpManager: {
    toolDefs: () => [{ name: 'mcp__demo__echo', description: 'echo', inputSchema: { type: 'object' } }],
    callTool: async (_n: string, args: { msg: string }) => ({ content: [{ type: 'text', text: largeResult ? 'body '.repeat(20000) + 'TAIL_EVIDENCE' : `echo:${args.msg}` }], isError: false }),
  },
}));

const { initDb, closeDb } = await import('../src/db/database.js');
const { ensureDirs } = await import('../src/config.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { runAgent } = await import('../src/agent/loop.js');

beforeEach(() => {
  calls.length = 0;
  largeResult = false;
  ensureDirs();
  initDb(path.join(tmp, `t-${Date.now()}.db`));
});
afterEach(() => closeDb());

describe('runAgent', () => {
  it.each(['openai', 'anthropic'] as const)('handles a large result then a saved-original read with %s', async type => {
    largeResult = true;
    const p = providersRepo.create({ name: 'p', type, baseUrl: 'http://x', apiKey: 'k' });
    const m = modelsRepo.upsert(p.id, { modelId: 'test' });
    const conv = conversationsRepo.create({ providerId: p.id, modelId: m.id });
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'research' }] });
    const events: ChatSSEEvent[] = [];
    await runAgent({ conversation: conv, signal: new AbortController().signal, emit: e => void events.push(e) });
    expect(calls).toHaveLength(3);
    const msgs = messagesRepo.list(conv.id);
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    const preview = msgs[2]!.content[0]!;
    const page = msgs[4]!.content[0]!;
    expect(preview.type).toBe('tool_result');
    expect(page.type).toBe('tool_result');
    if (preview.type !== 'tool_result' || page.type !== 'tool_result') throw new Error('expected results');
    expect(JSON.stringify(preview.content).length).toBeLessThan(8500);
    expect(JSON.stringify(page.content)).toContain('TAIL_EVIDENCE');
    expect(JSON.stringify(page.content)).not.toContain('Tool result preview');
    const resultEvents = events.filter(e => e.event === 'tool_result');
    expect(resultEvents.map(e => e.data.content)).toEqual([preview.content, page.content]);
    expect((calls[0] as { tools: Array<{ name: string }> }).tools.some(t => t.name === 'context__read_result')).toBe(true);
    expect((calls[2] as { messages: Array<{ content: unknown }> }).messages[2]!.content).toEqual(msgs[2]!.content);
  });

  it('runs a tool loop and persists assistant + tool_result messages', async () => {
    const p = providersRepo.create({ name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
    const m = modelsRepo.upsert(p.id, { modelId: 'gpt-test' });
    const conv = conversationsRepo.create({ providerId: p.id, modelId: m.id });
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'say hi' }] });

    const events: ChatSSEEvent[] = [];
    await runAgent({ conversation: conversationsRepo.get(conv.id)!, signal: new AbortController().signal, emit: (e) => void events.push(e) });

    const types = events.map((e) => e.event);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    const msgs = messagesRepo.list(conv.id);
    expect(msgs.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[1]!.stopReason).toBe('tool_use');
    expect(msgs[2]!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'echo:hi' }], is_error: false });
    expect(msgs[3]!.content).toEqual([{ type: 'text', text: 'done: hi' }]);
    expect(msgs[3]!.usage).toEqual({ input: 10, output: 5 });
    // second request contained the tool result in history
    const second = calls[1] as { messages: Array<{ role: string }> };
    expect(second.messages.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
  });
});
