import { afterEach, expect, it, vi } from 'vitest';
import type { ApiTrace, ApiTraceDetail } from '@aichat/shared';
import { OpenAIAdapter } from '../src/llm/openai/adapter.js';
import { AnthropicAdapter } from '../src/llm/anthropic/adapter.js';
import { traceRequests, type TraceAttempt } from '../src/llm/trace.js';
import { initDb, closeDb } from '../src/db/database.js';
import { apiTracesRepo } from '../src/db/repos/apiTraces.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { messagesRepo } from '../src/db/repos/messages.js';
import { requestDiagnosticsRepo } from '../src/db/repos/requestDiagnostics.js';
import { conversationsRoute } from '../src/routes/conversations.js';
import { Hono } from 'hono';

const provider = { id: 'p', name: 'Provider', baseUrl: 'https://example.test/v1?token=URL_SECRET', apiKey: 'credential-secret', extraHeaders: { 'x-private': 'private-header-secret' }, compat: {}, createdAt: '' };
const request = { model: 'model-x', system: 'system prompt', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'User content' }] }], maxTokens: 200, reasoning: 'high' as const };
const consume = async (stream: AsyncIterable<unknown>) => { for await (const _ of stream) void _; };
const success = () => new Response('data: {"id":"answer-id","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: {"id":"answer-id","choices":[],"usage":{"prompt_tokens":32,"completion_tokens":3}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-42' } });
afterEach(() => { vi.unstubAllGlobals(); closeDb(); });

it('captures serialized OpenAI JSON and retry attempts without credentials, while preserving the sent payload', async () => {
  const snapshots: TraceAttempt[] = [];
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    sent.push(init.body);
    return sent.length === 1 ? new Response('busy', { status: 429, headers: { 'retry-after-ms': '1' } }) : success();
  }));
  await consume(new OpenAIAdapter({ ...provider, type: 'openai' }).stream({ ...request, messages: [{ role: 'user', content: [{ type: 'text', text: 'User content credential-secret private-header-secret' }] }], onTrace: r => snapshots.push(r) }));
  const records = [...new Map(snapshots.map(r => [r.id, r])).values()];
  expect(records).toHaveLength(2);
  expect(snapshots[0]!.status).toBe('running');
  expect(records[0]).toMatchObject({ attempt: 1, status: 'error', httpStatus: 429 });
  expect(records[1]).toMatchObject({ attempt: 2, status: 'complete', httpStatus: 200, requestId: 'request-42', responseId: 'answer-id', rawUsage: { prompt_tokens: 32 }, responseHeaders: { 'content-type': 'text/event-stream', 'x-request-id': 'request-42' } });
  expect(records[1]!.responseBody).toContain('data: [DONE]');
  expect(records[1]!.responseBytes).toBeGreaterThan(100);
  expect(records[0]!.responseBody).toBe('busy');
  expect(records[1]!.requestBody).toMatchObject({ stream: true, model: 'model-x', reasoning_effort: 'high', messages: [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'User content [REDACTED] [REDACTED]' }] });
  expect(JSON.stringify(records)).not.toMatch(/credential-secret|private-header-secret|URL_SECRET/);
  expect(sent[0]).toContain('credential-secret');
  expect(records[1]!.requestHeaders).not.toHaveProperty('authorization');
});

it('captures Anthropic SDK additions and protocol parameters on HTTP failure', async () => {
  let sent: unknown;
  const records: TraceAttempt[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response('{"error":{"type":"invalid_request_error","message":"bad"}}', { status: 400, headers: { 'content-type': 'application/json' } });
  }));
  await expect(consume(new AnthropicAdapter({ ...provider, baseUrl: 'https://example.test', type: 'anthropic' }).stream({ ...request, onTrace: r => records.push(r) }))).rejects.toThrow();
  expect(records.at(-1)).toMatchObject({ status: 'error', httpStatus: 400, requestBody: { stream: true, thinking: { type: 'enabled' }, output_config: { effort: 'high' } } });
  expect(records.at(-1)!.responseBody).toContain('invalid_request_error');
  expect(records.at(-1)!.requestBody).toEqual(sent);
  expect(records.at(-1)!.url).toBe('https://example.test/v1/messages');
});

it('records aborts and isolates concurrent requests on a cached adapter', async () => {
  const adapter = new OpenAIAdapter({ ...provider, type: 'openai' });
  const first: TraceAttempt[] = [], second: TraceAttempt[] = [];
  const abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (JSON.parse(init.body).model === 'aborted') {
      abort.abort();
      throw new DOMException('aborted', 'AbortError');
    }
    return success();
  }));
  await Promise.allSettled([
    consume(adapter.stream({ ...request, model: 'aborted', signal: abort.signal, onTrace: r => first.push(r) })),
    consume(adapter.stream({ ...request, model: 'normal', onTrace: r => second.push(r) })),
  ]);
  expect(first.at(-1)).toMatchObject({ model: 'aborted', status: 'interrupted', attempt: 1 });
  expect(second.at(-1)).toMatchObject({ model: 'normal', status: 'complete', attempt: 1 });
  expect(first[0]!.id).not.toEqual(second[0]!.id);
});

it('serves the conversation log or one turn, with lazy bodies, legacy fallback and deletion cleanup', async () => {
  initDb(':memory:');
  const conv = conversationsRepo.create({ title: 'trace test' });
  const turn = messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'question' }] });
  const answer = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: [] });
  const secondTurn = messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'next' }] });
  const secondAnswer = messagesRepo.create({ conversationId: conv.id, role: 'assistant', content: [] });
  const record: ApiTraceDetail = { id: 'trace', conversationId: conv.id, turnId: turn.id, messageId: answer.id, providerId: 'p', providerName: 'P', purpose: 'chat', protocol: 'openai', model: 'm', attempt: 1, startedAt: new Date().toISOString(), durationMs: 10, status: 'complete', method: 'POST', url: 'https://example.test', bodyAvailable: true, notes: [], requestHeaders: {}, requestBody: { messages: ['actual prompt'] }, responseHeaders: { 'content-type': 'text/event-stream' }, responseBody: 'data: {"raw":true}\n\n' };
  apiTracesRepo.save({ ...record, status: 'running' });
  apiTracesRepo.interruptPending();
  expect(apiTracesRepo.get(conv.id, 'trace')?.status).toBe('interrupted');
  apiTracesRepo.save(record);
  const metadata = { protocol: 'openai' as const, model: 'm', startedAt: record.startedAt, durationMs: 1, systemHash: '', toolsHash: '', settingsHash: '', messageHashes: [], status: 'complete' as const };
  requestDiagnosticsRepo.save(conv.id, answer.id, 'p', metadata);
  requestDiagnosticsRepo.save(conv.id, secondAnswer.id, 'p', metadata);
  const app = new Hono().route('/conversations', conversationsRoute);
  const list = await (await app.request(`/conversations/${conv.id}/traces?turnId=${turn.id}`)).json() as ApiTrace[];
  expect(list).toHaveLength(1);
  expect(list[0]).not.toHaveProperty('requestBody');
  expect(list[0]).not.toHaveProperty('responseBody');
  const whole = await (await app.request(`/conversations/${conv.id}/traces`)).json() as ApiTrace[];
  expect(whole.map(r => [r.turnId, r.bodyAvailable])).toEqual([[turn.id, true], [secondTurn.id, false]]);
  expect((await app.request(`/conversations/${conv.id}/traces?turnId=${answer.id}`)).status).not.toBe(200);
  expect(await (await app.request(`/conversations/${conv.id}/traces/trace`)).json()).toMatchObject({ requestBody: { messages: ['actual prompt'] }, responseBody: 'data: {"raw":true}\n\n', responseHeaders: { 'content-type': 'text/event-stream' } });
  expect((await app.request('/conversations/other/traces/trace')).status).not.toBe(200);
  const legacy = await (await app.request(`/conversations/${conv.id}/traces?turnId=${secondTurn.id}`)).json() as ApiTrace[];
  expect(legacy).toHaveLength(1);
  expect(legacy[0]).toMatchObject({ bodyAvailable: false, messageId: secondAnswer.id });
  messagesRepo.deleteFrom(conv.id, answer.seq);
  expect(apiTracesRepo.get(conv.id, 'trace')).toBeNull();
  apiTracesRepo.save({ ...record, messageId: 'pending' });
  conversationsRepo.delete(conv.id);
  expect(apiTracesRepo.get(conv.id, 'trace')).toBeNull();
});


it('summarizes embedded media and redacts credential fields without changing the network request', async () => {
  const records: TraceAttempt[] = [];
  const body = JSON.stringify({ source: { type: 'base64', data: 'aGk=' }, image_url: { url: 'data:image/png;base64,aGk=' }, input: { api_key: 'user-tool-secret' }, document: { type: 'text', data: 'plain text stays readable' } });
  const network = vi.fn(async () => success());
  vi.stubGlobal('fetch', network);
  await traceRequests({ ...provider, type: 'anthropic' }, 'm', r => records.push(r)).fetch!('https://example.test', { method: 'POST', body });
  const stored = JSON.stringify(records);
  expect(stored).not.toContain('aGk=');
  expect(stored).not.toContain('user-tool-secret');
  expect(stored).toContain('sha256=');
  expect(stored).toContain('plain text stays readable');
  expect(network).toHaveBeenCalledWith('https://example.test', { method: 'POST', body });
});
