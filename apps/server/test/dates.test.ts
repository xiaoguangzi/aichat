import { describe, expect, it } from 'vitest';
import type { Block } from '@aichat/shared';
import { conversationDate, localDate, withDateNotes } from '../src/agent/dates.js';

const tz = 'Asia/Shanghai';
const text = (s: string): Block[] => [{ type: 'text', text: s }];
const user = (s: string, createdAt: string) => ({ role: 'user' as const, content: text(s), createdAt });
const reply = (createdAt: string) => ({ role: 'assistant' as const, content: text('ok'), createdAt });
const toolResult = (createdAt: string) => ({
  role: 'user' as const, createdAt,
  content: [{ type: 'tool_result', tool_use_id: 't', content: text('r'), is_error: false }] as Block[],
});

describe('model-facing dates', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 2026-10-26 23:30 UTC is already Tuesday morning in Shanghai
    expect(localDate('2026-10-26T23:30:00Z', tz)).toBe('2026-10-27 (Tuesday)');
  });

  it('anchors the conversation to its first user message', () => {
    const msgs = [user('hi', '2026-10-25T02:00:00Z'), reply('2026-10-25T02:00:05Z'), user('again', '2026-10-27T02:00:00Z')];
    expect(conversationDate(msgs, tz)).toBe('2026-10-25 (Sunday)');
  });

  it('notes a day change once, on the first user message of the new day, and replays identically', () => {
    const day1 = [user('a', '2026-10-25T02:00:00Z'), reply('2026-10-25T02:00:05Z'), user('b', '2026-10-25T09:00:00Z'), reply('2026-10-25T09:00:05Z')];
    const day2 = [user('c', '2026-10-26T02:00:00Z'), reply('2026-10-26T02:00:05Z'), toolResult('2026-10-26T02:00:06Z'), user('d', '2026-10-26T03:00:00Z')];
    const start = conversationDate(day1, tz);
    const out = withDateNotes([...day1, ...day2], start, tz);
    const notes = out.filter(m => m.content[0]?.type === 'text' && m.content[0].text.startsWith('[Date update'));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.content[1]).toEqual({ type: 'text', text: 'c' });
    expect(JSON.stringify(notes[0]!.content[0])).toContain('2026-10-26 (Monday)');
    // the tool result keeps its shape; protocols require tool results to stand alone
    expect(out[6]).toBe(day2[2]);
    // an earlier request is a prefix of a later one, so the prompt cache stays valid
    expect(withDateNotes([...day1, day2[0]!], start, tz)).toEqual(out.slice(0, 5));
  });
});
