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

  it.each([
    'some relays use `<thinking>...</thinking>` tags; continue thinking',
    'some relays use ``<think>`quoted`</think>`` tags; continue thinking',
    'example:\n```xml\n<thinking>example</thinking>\n```\ncontinue thinking',
    'example:\n~~~xml\n<think>example</think>\n~~~\ncontinue thinking',
  ])('keeps quoted tags inside reasoning: %s', (reasoning) => {
    const source = `<think>${reasoning}</think>Final answer`;
    // Every possible two-chunk split, plus one-character streaming, must agree.
    const variants = [Array.from(source), ...Array.from({ length: source.length + 1 }, (_, i) => [source.slice(0, i), source.slice(i)])];
    for (const chunks of variants) {
      const evs = run(chunks);
      expect(thoughts(evs)).toBe(reasoning);
      expect(texts(evs)).toBe('Final answer');
      expect(evs.some((e) => e.type === 'thinking_reclassify')).toBe(false);
    }
  });

  it('does not reclassify an answer explaining closing tags in code', () => {
    const source = 'Use `</think>` or `</thinking>` to close the span.';
    const evs = run(Array.from(source));
    expect(texts(evs)).toBe(source);
    expect(evs.some((e) => e.type === 'thinking_reclassify')).toBe(false);
  });

  it('ignores a quoted close before rescuing the actual template close', () => {
    const source = 'Discuss `</thinking>` and continue.\n</think>Final answer';
    const evs = run(Array.from(source));
    const i = evs.findIndex((e) => e.type === 'thinking_reclassify');
    expect(texts(evs.slice(0, i))).toBe('Discuss `</thinking>` and continue.\n');
    expect(texts(evs.slice(i))).toBe('Final answer');
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
