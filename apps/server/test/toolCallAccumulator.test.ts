import { describe, it, expect } from 'vitest';
import { ToolCallAccumulator } from '../src/llm/openai/toolCallAccumulator.js';

describe('ToolCallAccumulator', () => {
  it('accumulates two parallel tool calls from fragments', () => {
    const acc = new ToolCallAccumulator();
    const ev = [
      ...acc.push([{ index: 0, id: 'c1', function: { name: 'get_weather', arguments: '' } }]),
      ...acc.push([{ index: 0, function: { arguments: '{"city":' } }]),
      ...acc.push([{ index: 1, id: 'c2', function: { name: 'get_time', arguments: '{}' } }]),
      ...acc.push([{ index: 0, function: { arguments: '"Paris"}' } }]),
      ...acc.finish(),
    ];
    expect(ev.filter((e) => e.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', id: 'c1', name: 'get_weather' },
      { type: 'tool_call_start', id: 'c2', name: 'get_time' },
    ]);
    const ends = ev.filter((e) => e.type === 'tool_call_end') as Array<{ id: string; input: unknown }>;
    expect(ends).toEqual([{ type: 'tool_call_end', id: 'c1', input: { city: 'Paris' } }, { type: 'tool_call_end', id: 'c2', input: {} }]);
  });

  it('preserves the registered MCP name across retries', () => {
    const acc = new ToolCallAccumulator();
    const name = 'mcp__exa__web_search_exa';
    for (const id of ['first', 'retry']) {
      expect(acc.push([{ index: 0, id, function: { name, arguments: '{"query":"test"}' } }])).toEqual([
        { type: 'tool_call_start', id, name },
        { type: 'tool_call_delta', id, argsDelta: '{"query":"test"}' },
      ]);
      expect(acc.finish()).toEqual([{ type: 'tool_call_end', id, input: { query: 'test' } }]);
    }
  });

  it('accepts a name arriving after the initial fragment', () => {
    const acc = new ToolCallAccumulator();
    expect(acc.push([{ index: 0, id: 'late', function: { name: null } }])).toEqual([]);
    expect(acc.push([{ index: 0, function: { name: 'get_weather', arguments: '{}' } }])).toEqual([
      { type: 'tool_call_start', id: 'late', name: 'get_weather' },
      { type: 'tool_call_delta', id: 'late', argsDelta: '{}' },
    ]);
    expect(acc.finish()).toEqual([{ type: 'tool_call_end', id: 'late', input: {} }]);
  });

  it('keeps raw text when JSON is broken', () => {
    const acc = new ToolCallAccumulator();
    acc.push([{ index: 0, id: 'x', function: { name: 'f', arguments: '{oops' } }]);
    const end = acc.finish().find((e) => e.type === 'tool_call_end') as { input: unknown };
    expect(end.input).toEqual({ _raw: '{oops' });
  });
});
