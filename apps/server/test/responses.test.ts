import { afterEach, expect, it, vi } from 'vitest';
import { ResponsesAdapter } from '../src/llm/responses/adapter.js';
import { toResponsesInput, toResponsesTools } from '../src/llm/responses/convert.js';
import { getAdapter, evictAdapter } from '../src/llm/registry.js';
import type { StreamEvent } from '@aichat/shared';
import type { TraceAttempt } from '../src/llm/trace.js';
import type { LLMRequest } from '../src/llm/types.js';

const provider = { id: 'responses-test', name: 'test', type: 'openai' as const, baseUrl: 'https://example.test/v1', apiKey: 'secret-test-key', extraHeaders: {}, compat: { apiFormat: 'responses' as const }, createdAt: '' };
const req: LLMRequest = { model: 'test', system: 'System', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], reasoning: 'high', maxTokens: 200 };
const summary = [{ type: 'summary_text' as const, text: 'Thinking' }];
const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary };
const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"q":"hi"}' };
const terminal = (type = 'response.completed') => ({ type, response: { id: 'resp_1', output: [], usage: { input_tokens: 40, output_tokens: 10, input_tokens_details: { cached_tokens: 20 } }, incomplete_details: type === 'response.incomplete' ? { reason: 'max_output_tokens' } : null } });
function serve(events: unknown[]) {
  const fetch = vi.fn(async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_1' } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function collect(request: LLMRequest = req) {
  evictAdapter(provider.id);
  const out: StreamEvent[] = [];
  for await (const e of getAdapter(provider).stream(request)) out.push(e);
  return out;
}
afterEach(() => vi.unstubAllGlobals());

it('sends native Responses params and captures wire trace, text, summary and cache usage', async () => {
  const fetch = serve([
    { type: 'response.reasoning_summary_text.delta', delta: 'Thinking' },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.output_text.delta', delta: 'Hello' }, terminal(),
  ]);
  const traces: TraceAttempt[] = [];
  const events = await collect({ ...req, tools: [{ name: 'lookup', description: 'Find', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }], onTrace: t => traces.push(t) });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://example.test/v1/responses');
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ instructions: 'System', stream: true, store: false, max_output_tokens: 200, reasoning: { effort: 'high', summary: 'auto' }, tools: [{ type: 'function', name: 'lookup', strict: false }] });
  for (const key of ['messages', 'max_tokens', 'max_completion_tokens', 'reasoning_effort', 'stream_options', 'previous_response_id']) expect(body).not.toHaveProperty(key);
  expect(events).toContainEqual({ type: 'text_delta', text: 'Hello' });
  expect(events).toContainEqual({ type: 'thinking_delta', text: 'Thinking' });
  expect(events).toContainEqual({ type: 'responses_reasoning', item: { id: 'rs_1', encrypted_content: 'opaque', summary } });
  expect(events).toContainEqual({ type: 'usage', usage: { input: 40, output: 10, cacheRead: 20, inputUncached: 20, inputTotalKnown: true, usageComplete: true } });
  expect(traces.at(-1)).toMatchObject({ status: 'complete', requestId: 'req_1', responseId: 'resp_1', rawUsage: { input_tokens: 40 } });
  expect(JSON.stringify(traces)).not.toContain('secret-test-key');
});

it('preserves parallel function call IDs and replays reasoning and native tool results', async () => {
  serve([
    { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
    { type: 'response.output_item.added', output_index: 2, item: { ...call, id: 'fc_2', call_id: 'call_2', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"q":"hi"}' },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"q":"hi"}' },
    { type: 'response.output_item.done', output_index: 2, item: { ...call, id: 'fc_2', call_id: 'call_2' } },
    { type: 'response.output_item.done', output_index: 1, item: call }, terminal(),
  ]);
  const events = await collect();
  expect(events.filter(e => e.type === 'tool_call_end')).toEqual([{ type: 'tool_call_end', id: 'call_2', input: { q: 'hi' } }, { type: 'tool_call_end', id: 'call_1', input: { q: 'hi' } }]);
  expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  const input = toResponsesInput([
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Thinking', responsesReasoning: { id: 'rs_1', encrypted_content: 'opaque', summary } }, { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'hi' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'found' }, { type: 'image', mime: 'image/png', data: 'YWJj' }] }] },
  ]);
  expect(input[0]).toEqual(reasoning);
  expect(input[1]).toEqual({ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"hi"}' });
  expect(input[2]).toMatchObject({ type: 'function_call_output', call_id: 'call_1', output: [{ type: 'input_text', text: 'found' }, { type: 'input_image' }] });
});

it('converts PDF, image and ordinary document input without foreign thinking signatures', () => {
  const input = toResponsesInput([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'private', signature: 'anthropic-signature' }] }, { role: 'user', content: [{ type: 'document', name: 'x.pdf', mime: 'application/pdf', data: 'cGRm' }, { type: 'image', mime: 'image/png', data: 'aW1n' }, { type: 'document', name: 'x.txt', mime: 'text/plain', data: 'aGk=' }] }]);
  expect(input).toHaveLength(1);
  expect(input[0]).toMatchObject({ role: 'user', content: [{ type: 'input_file', filename: 'x.pdf', file_data: 'data:application/pdf;base64,cGRm' }, { type: 'input_image' }, { type: 'input_text', text: '<file name="x.txt">\nhi\n</file>' }] });
  expect(toResponsesTools([{ name: 'x', description: '', inputSchema: {} }])[0]).toHaveProperty('strict', false);
});

it.each(['response.failed', 'error', 'truncated', 'malformed'])('rejects %s instead of reporting success', async kind => {
  const events = kind === 'response.failed' ? [{ type: kind, response: { id: 'resp_1', error: { message: 'failed' } } }] : kind === 'error' ? [{ type: 'error', message: 'bad' }] : kind === 'malformed' ? [{ type: 'response.output_item.added', output_index: 0, item: call }, { type: 'response.output_item.done', output_index: 0, item: { ...call, arguments: '{' } }, terminal()] : [{ type: 'response.output_text.delta', delta: 'partial' }];
  serve(events);
  const traces: TraceAttempt[] = [];
  await expect(collect({ ...req, onTrace: t => traces.push(t) })).rejects.toThrow();
  expect(traces.at(-1)?.status).toBe('error');
});

it('distinguishes refusal and output limits', async () => {
  serve([{ type: 'response.refusal.delta', delta: 'Cannot comply' }, terminal()]);
  expect((await collect()).at(-1)).toEqual({ type: 'done', stopReason: 'refusal' });
  serve([{ type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } }, terminal('response.incomplete')]);
  expect((await collect()).at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
});

it('honors explicit off mappings and temperature compatibility without Chat Completions dialects', async () => {
  const fetch = serve([terminal()]);
  const adapter = new ResponsesAdapter({ ...provider, compat: { ...provider.compat, sendTemperature: false, thinkingFormat: 'zai' } });
  for await (const _ of adapter.stream({ ...req, reasoning: 'off', reasoningMap: { off: 'none' }, temperature: 1 })) void _;
  const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.reasoning).toEqual({ effort: 'none' });
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('thinking');
});

it('marks cancellation as interrupted and never invents missing usage', async () => {
  serve([{ type: 'response.completed', response: { id: 'resp_no_usage', output: [] } }]);
  expect((await collect()).some(e => e.type === 'usage')).toBe(false);
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw controller.signal.reason; }));
  const diagnostics: Array<{ status: string }> = [];
  await expect(collect({ ...req, signal: controller.signal, onDiagnostic: d => diagnostics.push(d) })).rejects.toThrow();
  expect(diagnostics.at(-1)?.status).toBe('interrupted');
});
