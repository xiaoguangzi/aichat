import { describe, expect, it } from 'vitest';
import type { Block } from '@aichat/shared';
import { shapeOldTurns } from '../src/agent/history.js';
import { config } from '../src/config.js';
import { toOpenAIMessages } from '../src/llm/openai/convert.js';
import { toAnthropicMessages } from '../src/llm/anthropic/convert.js';
import type { LLMMessage } from '../src/llm/types.js';

const text = (s: string): Block[] => [{ type: 'text', text: s }];
const question = (s: string): LLMMessage => ({ role: 'user', content: text(s) });
function turn(id: string, size: number): LLMMessage[] {
  return [question(id),
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reasoning', signature: 'sig' }, { type: 'tool_use', id, name: 'demo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, resultId: `result_${id}`, content: text('x'.repeat(size)), is_error: false }] },
    { role: 'assistant', content: text('answer') },
  ];
}
const body = (m: LLMMessage) => JSON.stringify(m.content);

describe('budgeted history replay', () => {
  it.each(['openai', 'anthropic'] as const)('keeps the cached prefix across a user boundary for %s', protocol => {
    const history = turn('one', 8000);
    const convert = protocol === 'openai' ? toOpenAIMessages.bind(null, undefined) : toAnthropicMessages;
    const before = convert(shapeOldTurns(history, protocol));
    const after = convert(shapeOldTurns([...history, question('follow up')], protocol));
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('compacts old complete turns in batches, keeps recent evidence and all pairing/prose', () => {
    const history = [...turn('one', 24000), ...turn('two', 24000), ...turn('three', 8000)];
    const snapshot = JSON.stringify(history);
    const shaped = shapeOldTurns(history);
    expect(body(shaped[2]!)).toContain('result_one');
    expect(body(shaped[2]!)).toContain('Old tool result cleared');
    expect(body(shaped[6]!)).toContain('result_two');
    expect(body(shaped[10]!)).toContain('x'.repeat(8000));
    expect(shaped[3]).toBe(history[3]); // assistant answer
    expect(shaped[4]).toBe(history[4]); // user question
    expect(shaped[9]).toBe(history[9]); // current thinking
    expect(JSON.stringify(history)).toBe(snapshot);
    for (const convert of [toOpenAIMessages.bind(null, undefined), toAnthropicMessages]) {
      const wire = JSON.stringify(convert(shaped));
      for (const id of ['one', 'two', 'three']) expect(wire).toContain(id);
    }
  });

  it('replays the same historical checkpoints after more turns or a restart', () => {
    const history = [...turn('one', 26000), ...turn('two', 26000), ...turn('three', 6000)];
    const first = shapeOldTurns(history);
    const appended = shapeOldTurns([...history, ...turn('four', 6000)]);
    expect(appended.slice(0, first.length)).toEqual(first);
    expect(shapeOldTurns(JSON.parse(JSON.stringify(history)))).toEqual(first);
  });

  it('does not compact inside the active tool loop even if over budget', () => {
    const history = turn('current', config.historyHighWaterChars * 2);
    expect(shapeOldTurns(history)).toEqual(history);
    const shaped = shapeOldTurns([...history, question('next')]);
    expect(body(shaped[2]!)).toContain('Old tool result cleared');
  });

  it('does not spend the OpenAI history budget on thinking that its converter omits', () => {
    const history = turn('a', 3000);
    history[1]!.content.unshift({ type: 'thinking', thinking: 't'.repeat(config.historyHighWaterChars) });
    const input = [...history, question('next')];
    expect(shapeOldTurns(input, 'openai')).toEqual(input);
    expect(body(shapeOldTurns(input, 'anthropic')[2]!)).toContain('Old tool result cleared');
  });

  it('preserves old preview reader IDs and legacy excerpts when budget is exceeded', () => {
    const legacy = turn('legacy', 60000);
    const result = legacy[2]!.content[0]!;
    if (result.type !== 'tool_result') throw new Error('result');
    delete result.resultId;
    result.content = text('result_id: result_saved\ntotal_chars: 99999\n' + 'x'.repeat(60000));
    expect(body(shapeOldTurns([...legacy, question('next')])[2]!)).toContain('result_saved');
    result.content = text('LEGACY HEAD ' + 'x'.repeat(60000));
    expect(body(shapeOldTurns([...legacy, question('next')])[2]!)).toContain('LEGACY HEAD');
  });

  it('removes old media and thinking together when a compaction is needed', () => {
    const history = turn('media', 10);
    const b = history[2]!.content[0]!;
    if (b.type !== 'tool_result') throw new Error('result');
    b.content.push(...Array.from({ length: 7 }, (): Block => ({ type: 'image', mime: 'image/png', data: 'AAAA' })));
    const shaped = shapeOldTurns([...history, question('next')]);
    expect(body(shaped[2]!)).toContain('media attachment(s) removed');
    expect(body(shaped[2]!)).not.toContain('AAAA');
    expect(shaped[1]!.content.some(b => b.type === 'thinking')).toBe(false);
  });
});


it('keeps official DeepSeek thinking through compaction and restart while clearing tool results', () => {
  const history = [...turn('old', 60000), question('next')];
  const shaped = shapeOldTurns(history, 'openai', true);
  expect(shaped[1]).toEqual(history[1]);
  expect(body(shaped[2]!)).toContain('Old tool result cleared');
  expect(shapeOldTurns(JSON.parse(JSON.stringify(history)), 'openai', true)).toEqual(shaped);
  expect(JSON.stringify(toOpenAIMessages(undefined, shaped, true))).toContain('"reasoning_content":"reasoning"');
  expect(shapeOldTurns(history, 'openai')[1]!.content.some(b => b.type === 'thinking')).toBe(false);
});
