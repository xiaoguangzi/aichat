import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@aichat/shared';
import { OpenAIAdapter } from '../src/llm/openai/adapter.js';
import { AnthropicAdapter } from '../src/llm/anthropic/adapter.js';
import { applyPromptCaching, supportsPromptCaching } from '../src/llm/anthropic/cache.js';
import { requestDiagnostics, type RequestDiagnostic } from '../src/llm/diagnostics.js';
import { anthropicUsage, openAIUsage } from '../src/llm/usage.js';
import type Anthropic from '@anthropic-ai/sdk';

const provider = { id: 'p', name: 'p', baseUrl: 'http://test.local', apiKey: 'secret-key', extraHeaders: {}, compat: {}, createdAt: '' };
const req = { model: 'any-model', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'private user text' }] }], maxTokens: 200, reasoning: 'off' as const };
function mockSSE(events: Array<{ event?: string; data: unknown }>) {
  const data = events.map(e => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(data, { headers: { 'content-type': 'text/event-stream', 'request-id': 'req-a', 'x-request-id': 'req-o' } })));
}
afterEach(() => vi.unstubAllGlobals());

it('takes Anthropic cumulative cache counters from later deltas/final usage, not just message_start', async () => {
  const raw = [
    { type: 'message_start', message: { id: 'msg1', type: 'message', role: 'assistant', model: 'any-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300 } },
    { type: 'message_stop' },
  ];
  mockSSE(raw.map(data => ({ event: data.type, data })));
  const records: RequestDiagnostic[] = [];
  const events: StreamEvent[] = [];
  for await (const e of new AnthropicAdapter({ ...provider, type: 'anthropic' }).stream({ ...req, onDiagnostic: r => records.push(r) })) events.push(e);
  expect(events.find(e => e.type === 'usage')).toMatchObject({ usage: { input: 2310, inputUncached: 10, cacheRead: 2000, cacheWrite: 300, output: 5, inputTotalKnown: true } });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ status: 'complete', requestId: 'req-a', responseId: 'msg1', rawUsage: { cache_read_input_tokens: 2000 } });
  expect(JSON.stringify(records)).not.toContain('private user text');
  expect(JSON.stringify(records)).not.toContain('secret-key');
});

it.each([undefined, 0, 128])('preserves OpenAI missing/zero/nonzero cache usage (%s)', async cache => {
  mockSSE([
    { data: { id: 'chat1', choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }] } },
    { data: { id: 'chat1', choices: [], usage: { prompt_tokens: 256, completion_tokens: 5, ...(cache === undefined ? {} : { prompt_tokens_details: { cached_tokens: cache } }) } } },
    { data: '[DONE]' },
  ]);
  const records: RequestDiagnostic[] = [];
  const events: StreamEvent[] = [];
  for await (const e of new OpenAIAdapter({ ...provider, type: 'openai' }).stream({ ...req, onDiagnostic: r => records.push(r) })) events.push(e);
  expect(events.find(e => e.type === 'usage')).toMatchObject({ usage: { input: 256, cacheRead: cache } });
  expect(records[0]).toMatchObject({ status: 'complete', requestId: 'req-o', responseId: 'chat1' });
});

it('does not invent Anthropic cache stats when a gateway omits them', () => {
  expect(anthropicUsage({ input_tokens: 500, output_tokens: 9 })).toMatchObject({ input: 500, inputTotalKnown: false, cacheRead: undefined, cacheWrite: undefined });
  expect(openAIUsage({ prompt_tokens: 500, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 0 } })).toMatchObject({ inputUncached: 500, cacheRead: 0 });
});

it('records requests without usage and failed requests without fabricating usage', async () => {
  mockSSE([{ data: { id: 'chat1', choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] } }, { data: '[DONE]' }]);
  const records: RequestDiagnostic[] = [];
  const adapter = new OpenAIAdapter({ ...provider, type: 'openai' });
  for await (const _ of adapter.stream({ ...req, onDiagnostic: r => records.push(r) })) void _;
  expect(records[0]).toMatchObject({ rawUsage: undefined, status: 'complete' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400, headers: { 'content-type': 'application/json' } })));
  await expect((async () => { for await (const _ of new OpenAIAdapter({ ...provider, type: 'openai' }).stream({ ...req, onDiagnostic: r => records.push(r) })) void _; })()).rejects.toThrow();
  expect(records[1]).toMatchObject({ rawUsage: undefined, status: 'error' });
});

describe('cache request construction', () => {
  it('adds at most three 5m breakpoints and leaves canonical input untouched', () => {
    const params: Anthropic.MessageStreamParams = { model: 'm', max_tokens: 100, system: 'system', messages: [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'demo', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'result' }] },
    ] };
    applyPromptCaching(params);
    expect(JSON.stringify(params).match(/cache_control/g)).toHaveLength(3);
    expect(JSON.stringify(params)).not.toContain('1h');
    expect(params.messages[1]!.content).toEqual([{ type: 'tool_use', id: 't', name: 'demo', input: {} }]);
  });
  it('only auto-enables documented endpoint support; explicit compatibility settings override', () => {
    expect(supportsPromptCaching('https://api.anthropic.com', undefined)).toBe(true);
    expect(supportsPromptCaching('https://zenmux.ai/api/anthropic', 'auto')).toBe(true);
    expect(supportsPromptCaching('https://llm-api.x-aio.com/anthropic', 'auto')).toBe(false);
    expect(supportsPromptCaching('https://other.example', 'on')).toBe(true);
    expect(supportsPromptCaching('https://api.anthropic.com', 'off')).toBe(false);
  });
  it('fingerprints content independently of movable cache markers and catches real edits', () => {
    const records: RequestDiagnostic[] = [];
    const params = { ...req, system: 'stable system', tools: [{ name: 'demo' }] };
    requestDiagnostics('anthropic', params, r => records.push(r))({ status: 'complete' });
    requestDiagnostics('anthropic', { ...params, messages: [{ role: 'user', content: [{ type: 'text', text: 'private user text', cache_control: { type: 'ephemeral' } }] }] }, r => records.push(r))({ status: 'complete' });
    expect(records[0]!.messageHashes).toEqual(records[1]!.messageHashes);
    requestDiagnostics('anthropic', { ...params, messages: [{ role: 'user', content: [{ type: 'text', text: 'changed' }] }] }, r => records.push(r))({ status: 'complete' });
    expect(records[2]!.messageHashes).not.toEqual(records[0]!.messageHashes);
  });
});
