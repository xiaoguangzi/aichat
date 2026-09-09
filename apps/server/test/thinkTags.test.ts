import { describe, it, expect } from 'vitest';
import type { StreamEvent } from '@aichat/shared';
import { ThinkTagSplitter, splitInlineThinking } from '../src/llm/thinkTags.js';

function run(chunks: string[], extra: StreamEvent[] = []): StreamEvent[] {
  const s = new ThinkTagSplitter();
  const out: StreamEvent[] = [];
  for (const c of chunks) out.push(...s.push({ type: 'text_delta', text: c }));
  for (const e of extra) out.push(...s.push(e));
  out.push(...s.flush());
  return out;
}
const texts = (evs: StreamEvent[]) => evs.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
const thoughts = (evs: StreamEvent[]) => evs.filter((e) => e.type === 'thinking_delta').map((e) => e.text).join('');

describe('inline <think> tags', () => {
  it('splits an explicit pair at the start of the message', () => {
    const evs = run(['<think>reasoning here</think>the answer']);
    expect(thoughts(evs)).toBe('reasoning here');
    expect(texts(evs)).toBe('the answer');
    expect(evs.some((e) => e.type === 'thinking_reclassify')).toBe(false);
  });

  it('reclassifies when the template already opened the tag (DeepSeek)', () => {
    const evs = run(['reasoning ', 'here</think>the ', 'answer']);
    // the reasoning streams as text, then the close tag moves it to thinking
    expect(texts(evs)).toBe('reasoning herethe answer');
    const i = evs.findIndex((e) => e.type === 'thinking_reclassify');
    expect(i).toBeGreaterThan(-1);
    expect(texts(evs.slice(i))).toBe('the answer');
  });

  it('handles a tag split across deltas', () => {
    const evs = run(['<thi', 'nk>why</th', 'ink>done']);
    expect(thoughts(evs)).toBe('why');
    expect(texts(evs)).toBe('done');
  });

  it('leaves a stray close tag alone once the provider sent real thinking', () => {
    const s = new ThinkTagSplitter();
    const out: StreamEvent[] = [];
    out.push(...s.push({ type: 'thinking_delta', text: 'native' }));
    out.push(...s.push({ type: 'text_delta', text: 'write </think> to close' }));
    out.push(...s.flush());
    expect(texts(out)).toBe('write </think> to close');
    expect(out.some((e) => e.type === 'thinking_reclassify')).toBe(false);
  });

  it('rescues at most once and only an opener that starts the message', () => {
    const evs = run(['a</think>b</think>c <think>literal</think>']);
    expect(evs.filter((e) => e.type === 'thinking_reclassify')).toHaveLength(1);
    expect(texts(evs)).toBe('ab</think>c <think>literal</think>');
  });

  it('emits an unterminated thinking span as thinking', () => {
    const evs = run(['<think>still going']);
    expect(thoughts(evs)).toBe('still going');
    expect(texts(evs)).toBe('');
  });

  it('passes other events through and flushes before a tool call', async () => {
    async function* src(): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', text: '<think>plan</think>calling' };
      yield { type: 'tool_call_start', id: 't1', name: 'search' };
      yield { type: 'done', stopReason: 'tool_use' };
    }
    const out: StreamEvent[] = [];
    for await (const ev of splitInlineThinking(src())) out.push(ev);
    expect(thoughts(out)).toBe('plan');
    expect(texts(out)).toBe('calling');
    expect(out.map((e) => e.type)).toContain('tool_call_start');
    expect(out[out.length - 1]).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});
