import { describe, expect, it } from 'vitest';
import type { Block, ToolDef } from '@aichat/shared';
import { estimateBlock, estimateContext, estimateMessages, estimateText, estimateTools } from '../src/agent/context.js';
import { isContextOverflowError } from '../src/llm/contextOverflow.js';

describe('estimateText', () => {
  it('charges ASCII at about four characters per token', () => {
    expect(estimateText('abcd')).toBe(1);
    expect(estimateText('a'.repeat(400))).toBe(100);
    expect(estimateText('')).toBe(0);
  });

  it('charges CJK and other non-ASCII closer to one token per character', () => {
    const cjk = '上下文窗口'.repeat(10); // 50 chars
    expect(estimateText(cjk)).toBe(Math.ceil(50 / 1.5));
    // The same character count in ASCII must be strictly cheaper, which is the whole point of the
    // two-rate split: a Chinese conversation fills a window much faster than an English one.
    expect(estimateText('x'.repeat(50))).toBeLessThan(estimateText(cjk));
  });

  it('counts an emoji once rather than per UTF-16 unit', () => {
    // '🙂' is a surrogate pair: two code units, one code point.
    expect(estimateText('🙂')).toBe(1);
    expect(estimateText('🙂'.repeat(10))).toBe(Math.ceil(10 / 1.5));
  });
});

describe('estimateBlock', () => {
  it('sums nested tool result parts', () => {
    const block: Block = {
      type: 'tool_result', tool_use_id: 't', is_error: false,
      content: [{ type: 'text', text: 'abcd' }, { type: 'text', text: 'efgh' }],
    };
    expect(estimateBlock(block)).toBe(2);
  });

  it('charges a fixed weight for images and scales documents by payload', () => {
    expect(estimateBlock({ type: 'image', mime: 'image/png', data: 'x' })).toBe(1_600);
    const small = estimateBlock({ type: 'document', mime: 'application/pdf', name: 'a.pdf', data: 'x'.repeat(100) });
    const large = estimateBlock({ type: 'document', mime: 'application/pdf', name: 'a.pdf', data: 'x'.repeat(10_000) });
    expect(large).toBeGreaterThan(small);
  });

  it('counts tool input as JSON and thinking as text plus signature', () => {
    expect(estimateBlock({ type: 'tool_use', id: 't', name: 'echo', input: { msg: 'hi' } })).toBeGreaterThan(2);
    expect(estimateBlock({ type: 'thinking', thinking: 'abcd', signature: 'abcd' })).toBe(2);
  });
});

describe('estimateContext', () => {
  const messages = [{ content: [{ type: 'text', text: 'a'.repeat(400) } as Block] }];

  it('splits the payload into system, tools and history', () => {
    const tools: ToolDef[] = [{ name: 'echo', description: 'abcd', inputSchema: { type: 'object', properties: {} } }];
    const estimate = estimateContext({ system: 'a'.repeat(40), messages, tools });
    expect(estimate.system).toBe(10);
    expect(estimate.tools).toBe(estimateTools(tools));
    expect(estimate.history).toBe(estimateMessages(messages));
    expect(estimate.total).toBe(estimate.system + estimate.tools + estimate.history);
  });

  it('reports no ratio when the model window was never declared', () => {
    const estimate = estimateContext({ messages });
    // Inventing a denominator would turn a rough estimate into a confident-looking percentage.
    expect(estimate.budget).toBeNull();
    expect(estimate.ratio).toBeNull();
  });

  it('reports a ratio against the declared window, including reserved output', () => {
    const estimate = estimateContext({ messages, contextWindow: 1_000, reservedOutput: 100 });
    expect(estimate.budget).toBe(1_000);
    expect(estimate.reservedOutput).toBe(100);
    expect(estimate.ratio).toBeCloseTo((estimate.total + 100) / 1_000, 5);
    // A conversation that already exceeds its window clamps at 1 rather than reporting >100%.
    expect(estimateContext({ messages, contextWindow: 1 }).ratio).toBe(1);
  });

  it('counts one message even when it only carries role overhead', () => {
    expect(estimateMessages([{ content: [] }])).toBe(4);
  });
});

describe('isContextOverflowError', () => {
  it.each([
    'This model\'s maximum context length is 128000 tokens, however you requested 130000 tokens',
    "This model's maximum context length is 8192 tokens",
    'prompt is too long: 210000 tokens > 200000 maximum',
    'Requested token count exceeds the model\'s maximum context window of 128000 tokens.',
    'Input is too long for requested model.',
    'The input token count (129024) exceeds the maximum number of tokens allowed (128000).',
    '上下文长度超出限制',
    'context_length_exceeded',
    'Please reduce the length of the messages.',
  ])('recognises: %s', (message) => {
    expect(isContextOverflowError(message)).toBe(true);
  });

  it.each([
    'max_tokens is too large: 200000. This model supports at most 64000 completion tokens',
    'Invalid value for temperature',
    'Rate limit reached for gpt-4',
    'thinking parameter not supported',
    'Connection error',
    '',
  ])('leaves alone: %s', (message) => {
    // A false positive here would drop history for a request that could have succeeded.
    expect(isContextOverflowError(message)).toBe(false);
  });

  it('treats an over-long prompt as an overflow even when max_tokens is mentioned', () => {
    // A message can carry both complaints; the over-long history is the one worth repairing.
    expect(isContextOverflowError('max_tokens is too large: 200000; context_length_exceeded')).toBe(true);
  });
});
