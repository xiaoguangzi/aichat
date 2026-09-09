import { describe, it, expect } from 'vitest';
import { toOpenAIMessages, toOpenAITools } from '../src/llm/openai/convert.js';

describe('toOpenAIMessages', () => {
  it('maps system, text, tool_use and tool_result', () => {
    const out = toOpenAIMessages('sys', [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret', signature: 'x' },
          { type: 'text', text: 'calling' },
          { type: 'tool_use', id: 'call_1', name: 'mcp__fs__list', input: { path: '/' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'a.txt' }] }] },
    ]);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
    expect(out[2]).toMatchObject({ role: 'assistant', content: 'calling', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'mcp__fs__list', arguments: '{"path":"/"}' } }] });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'a.txt' });
    // thinking is dropped
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('turns images into data URLs', () => {
    const out = toOpenAIMessages(undefined, [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: 'AAAA' }, { type: 'text', text: 'what' }] }]);
    expect(out[0]).toMatchObject({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text', text: 'what' }] });
  });

  it('builds function tools', () => {
    expect(toOpenAITools([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }])[0]).toEqual({ type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } });
  });
});
