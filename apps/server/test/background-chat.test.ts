import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { ChatRunSnapshot, ChatSSEEvent, StreamEvent } from '@aichat/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-background-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');
let mode: 'text' | 'approval' | 'error';
let release: () => void;
let gate: Promise<void>;
let calls: number;
let modelSignal: AbortSignal;
const executeScript = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'tool finished' }], isError: false }));

vi.mock('../src/llm/registry.js', () => ({
  getAdapter: () => ({
    type: 'openai',
    async *stream({ signal }: { signal: AbortSignal }): AsyncIterable<StreamEvent> {
      modelSignal = signal;
      calls++;
      if (mode === 'approval' && calls === 1) {
        yield { type: 'tool_call_start', id: 't1', name: 'skill__run_script' };
        yield { type: 'tool_call_end', id: 't1', input: { name: 'demo', path: 'demo.sh' } };
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      yield { type: 'text_delta', text: 'reasoning before close' };
      yield { type: 'thinking_reclassify' };
      yield { type: 'text_delta', text: 'reply before close' };
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException('Stopped', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        void gate.then(() => { signal.removeEventListener('abort', abort); resolve(); });
      });
      if (mode === 'error') throw new Error('upstream failed');
      yield { type: 'text_delta', text: ' and after close' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  }),
  evictAdapter: () => {},
}));
vi.mock('../src/mcp/manager.js', () => ({ mcpManager: { toolDefs: () => [] } }));
vi.mock('../src/skills/registry.js', () => ({ skillRegistry: {
  get: () => ({ name: 'demo', autoApprove: false }), indexText: () => '',
} }));
vi.mock('../src/skills/tools.js', () => ({
  skillToolDefs: () => [{ name: 'skill__run_script', description: '', inputSchema: { type: 'object' } }],
  isSkillTool: (name: string) => name === 'skill__run_script',
  executeSkillTool: (...args: unknown[]) => executeScript(...args as []),
}));

const { initDb, closeDb } = await import('../src/db/database.js');
const { ensureDirs } = await import('../src/config.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { activeRuns, stopAllRuns } = await import('../src/agent/runs.js');
const { chatRoute } = await import('../src/routes/chat.js');
const { conversationsRoute } = await import('../src/routes/conversations.js');
const { errorToPayload } = await import('../src/util/errors.js');
let server: ReturnType<typeof serve>;
let base: string;
let id: string;
let readers: ReadableStreamDefaultReader<Uint8Array>[];

beforeEach(async () => {
  ensureDirs();
  initDb(path.join(tmp, `${crypto.randomUUID()}.db`));
  mode = 'text'; calls = 0; readers = [];
  executeScript.mockClear();
  gate = new Promise((resolve) => { release = resolve; });
  const provider = providersRepo.create({ name: 'test', type: 'openai', baseUrl: 'http://unused', apiKey: 'test' });
  const model = modelsRepo.upsert(provider.id, { modelId: 'test' });
  id = conversationsRepo.create({ title: 'test', providerId: provider.id, modelId: model.id }).id;
  const app = new Hono();
  app.route('/api/conversations', conversationsRoute);
  app.route('/api', chatRoute);
  app.onError((e, c) => { const p = errorToPayload(e); return c.json(p, p.status as 400); });
  await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(async () => {
  await stopAllRuns();
  release();
  for (const reader of readers) await reader.cancel().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
});

async function connect(post = false) {
  const response = await fetch(`${base}/conversations/${id}/${post ? 'messages' : 'events'}`, post ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'question' }),
  } : undefined);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  readers.push(reader);
  let buffer = '';
  const decoder = new TextDecoder();
  const next = async (): Promise<ChatSSEEvent> => {
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (event && data) return { event, data: JSON.parse(data) } as ChatSSEEvent;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE ended before expected event');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const until = async (type: ChatSSEEvent['event']) => {
    for (let i = 0; i < 100; i++) { const event = await next(); if (event.event === type) return event; }
    throw new Error(`Missing ${type}`);
  };
  return { reader, next, until };
}

describe('background generation over real HTTP connections', () => {
  it('finishes and persists after the page closes, with no subscriber connected', async () => {
    const original = await connect(true);
    await vi.waitFor(() => expect(activeRuns.get(id)?.snapshot().streaming?.content).toContainEqual({ type: 'text', text: 'reply before close' }));
    await original.reader.cancel(); // actually disconnect the browser's HTTP response
    const status = await fetch(`${base}/conversations/${id}/status`);
    expect(await status.json()).toEqual({ running: true });
    expect(modelSignal.aborted).toBe(false);
    const job = activeRuns.get(id)!;
    release(); await job.task;
    expect(modelSignal.aborted).toBe(false);
    expect(calls).toBe(1);
    const saved = messagesRepo.list(id);
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved[1]?.stopReason).toBe('end_turn');
    expect(saved[1]?.content).toContainEqual({ type: 'text', text: 'reply before close and after close' });
    const reopened = await connect();
    const snapshot = (await reopened.until('snapshot')).data as ChatRunSnapshot;
    expect(snapshot.running).toBe(false);
    expect(snapshot.messages).toEqual(saved);
    await reopened.until('done');
  });

  it('reopens during generation with partial thinking and text, then continues without duplication', async () => {
    const original = await connect(true);
    await vi.waitFor(() => expect(activeRuns.get(id)?.snapshot().streaming?.content).toHaveLength(2));
    await original.reader.cancel();
    const reopened = await connect();
    const snapshot = (await reopened.until('snapshot')).data as ChatRunSnapshot;
    expect(snapshot.running).toBe(true);
    expect(snapshot.streaming?.content).toEqual([
      { type: 'thinking', thinking: 'reasoning before close' }, { type: 'text', text: 'reply before close' },
    ]);
    expect(snapshot.messages).toHaveLength(1);
    release();
    const end = await reopened.until('message_end');
    expect(end.event === 'message_end' && end.data.message.content).toContainEqual({ type: 'text', text: 'reply before close and after close' });
    await reopened.until('done');
    expect(calls).toBe(1);
  });

  it('only an explicit stop interrupts the model and preserves the partial reply', async () => {
    const original = await connect(true);
    await vi.waitFor(() => expect(activeRuns.get(id)?.snapshot().streaming?.content).toHaveLength(2));
    await original.reader.cancel();
    const reopened = await connect();
    await fetch(`${base}/conversations/${id}/stop`, { method: 'POST' });
    await reopened.until('done');
    expect(modelSignal.aborted).toBe(true);
    expect(messagesRepo.list(id)[1]?.stopReason).toBe('interrupted');
    expect(messagesRepo.list(id)[1]?.content).toContainEqual({ type: 'text', text: 'reply before close' });
  });

  it('restores pending approval after close and does not run the script before approval', async () => {
    mode = 'approval';
    const original = await connect(true);
    await vi.waitFor(() => expect(activeRuns.get(id)?.snapshot().approval?.requestId).toBeTruthy());
    await original.reader.cancel();
    expect(executeScript).not.toHaveBeenCalled();
    const reopened = await connect();
    const snapshot = (await reopened.until('snapshot')).data as ChatRunSnapshot;
    expect(snapshot.approval?.tool).toBe('skill__run_script');
    expect(snapshot.messages[1]?.content[0]?.type).toBe('tool_use');
    release();
    const approval = await fetch(`${base}/approvals/${snapshot.approval!.requestId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: true }),
    });
    expect(approval.status).toBe(200);
    await reopened.until('done');
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(messagesRepo.list(id).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('persists upstream errors after close and releases the active job', async () => {
    mode = 'error';
    const original = await connect(true);
    await vi.waitFor(() => expect(activeRuns.get(id)?.snapshot().streaming?.content).toHaveLength(2));
    await original.reader.cancel();
    const job = activeRuns.get(id)!;
    release(); await job.task;
    expect(activeRuns.has(id)).toBe(false);
    expect(messagesRepo.list(id)[1]?.stopReason).toBe('error');
    expect(messagesRepo.list(id)[1]?.content).toHaveLength(2);
  });
});
