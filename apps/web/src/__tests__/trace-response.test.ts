import { expect, it } from 'vitest';
import { traceResponse } from '../lib/trace-response.js';

const sse = (...events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');

it('joins OpenAI reasoning aliases and interleaved tool arguments per choice and tool index', () => {
  const raw = sse(
    { choices: [{ index: 0, delta: { reasoning: '先', tool_calls: [{ index: 0, id: 'a', function: { name: 'search', arguments: '{' } }] } }] },
    { choices: [{ index: 1, delta: { content: '另一候选' } }, { index: 0, delta: { reasoning_text: '思考', tool_calls: [{ index: 1, id: 'b', function: { name: 'read', arguments: '{}' } }, { index: 0, function: { arguments: '"q":1}' } }] } }] },
    { choices: [{ index: 0, delta: { content: '回答' }, finish_reason: 'tool_calls' }] },
  ) + 'data: [DONE]\n\n';
  expect(traceResponse(raw)).toMatchObject({ partial: false, value: { choices: [
    { index: 0, thinking: '先思考', text: '回答', tool_calls: [{ id: 'a', function: { name: 'search', arguments: '{"q":1}' } }, { id: 'b', function: { name: 'read', arguments: '{}' } }] },
    { index: 1, text: '另一候选' },
  ] } });
});

it('joins Anthropic thinking, signatures, text, and tool input while keeping block order', () => {
  const raw = sse(
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '先' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '回答' } },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't', name: 'search', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"test"}' } },
    { type: 'message_stop' },
  ).replace(/\n/g, '\r\n');
  expect(traceResponse(raw)).toEqual({ partial: false, value: { content: [
    { type: 'thinking', thinking: '先思考', signature: 'sig' },
    { type: 'text', text: '回答' },
    { type: 'tool_use', id: 't', name: 'search', input: { q: 'test' } },
  ] } });
});

it('keeps complete deltas in a truncated stream and marks the result partial', () => {
  expect(traceResponse(sse({ choices: [{ delta: { reasoning_content: '保留这段' } }] }) + 'data: {"choices":['))
    .toMatchObject({ partial: true, value: { choices: [{ thinking: '保留这段' }] } });
  expect(traceResponse(null)).toBeNull();
  expect(traceResponse('unrecognized response')).toBeNull();
  expect(traceResponse('{"error":{"message":"failed"}}')).toEqual({ partial: false, value: { error: { message: 'failed' } } });
});

it('projects Responses final output and retains partial streaming reasoning', () => {
  const frames = [
    { type: 'response.created', response: { id: 'resp_1', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Think' },
  ];
  const raw = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('');
  expect(traceResponse(raw)).toMatchObject({ partial: true, value: { output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Think' }] }] } });
  const output = [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }];
  expect(traceResponse(raw + `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', output } })}\n\n`)).toEqual({ partial: false, value: { id: 'resp_1', output } });
});
