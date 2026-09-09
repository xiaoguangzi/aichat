import { describe, it, expect } from 'vitest';
import { toAnthropicMessages, fromAnthropicContent } from '../src/llm/anthropic/convert.js';

describe('toAnthropicMessages', () => {
  it('keeps signed thinking, degrades unsigned thinking to text, merges roles, drops leading assistant', () => {
    const out = toAnthropicMessages([
      { role: 'assistant', content: [{ type: 'text', text: 'orphan' }] },
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 'sig' }, { type: 'thinking', thinking: 'unsigned' }, { type: 'tool_use', id: 'tu1', name: 'x', input: { q: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'image', mime: 'image/png', data: 'AA' }], is_error: true }] },
    ]);
    expect(out[0]!.role).toBe('user');
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
    expect(out[1]!.content).toEqual([{ type: 'thinking', thinking: 't', signature: 'sig' }, { type: 'text', text: 'unsigned' }, { type: 'tool_use', id: 'tu1', name: 'x', input: { q: 1 } }]);
    expect(out[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } }], is_error: true }]);
  });

  it('allowEmptySignature replays unsigned thinking blocks as-is', () => {
    const out = toAnthropicMessages(
      [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'gw-thinking', signature: 'sig' }, { type: 'thinking', thinking: 'unsigned' }] },
      ],
      { allowEmptySignature: true },
    );
    expect(out[1]!.content).toEqual([
      { type: 'thinking', thinking: 'gw-thinking', signature: 'sig' },
      { type: 'thinking', thinking: 'unsigned', signature: '' },
    ]);
  });

  it('converts response content back to canonical', () => {
    const blocks = fromAnthropicContent([
      { type: 'text', text: 'hi', citations: null },
      { type: 'tool_use', id: 'i', name: 'n', input: { a: 1 } },
    ] as never);
    expect(blocks).toEqual([{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'i', name: 'n', input: { a: 1 } }]);
  });
});
