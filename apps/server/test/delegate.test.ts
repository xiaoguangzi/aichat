import { describe, expect, it, vi } from 'vitest';
import type { Block } from '@aichat/shared';
import { DELEGATE_TOOL, delegateTool, runDelegate, type DelegateRun } from '../src/agent/delegate.js';

const textOf = (content: Block[]) => content.filter((b) => b.type === 'text').map((b) => b.text).join('');

/** A sub-agent that echoes whatever it was asked, so the plumbing can be observed. */
const stub = (over: Partial<DelegateRun> = {}): DelegateRun => ({
  modelId: 'small-model',
  label: 'P / small',
  async *run(system, task) {
    yield `system=${system.slice(0, 20)}|task=${task}`;
  },
  ...over,
});

describe('delegate tool definition', () => {
  it('tells the model it gets one answer and cannot ask follow-ups', () => {
    expect(delegateTool.name).toBe(DELEGATE_TOOL);
    // Without this, a model hands over a vague task and then complains the result is useless.
    expect(delegateTool.description).toContain('cannot use tools or ask follow-up questions');
    expect(delegateTool.inputSchema).toMatchObject({ required: ['task'] });
  });
});

describe('runDelegate', () => {
  it('returns the sub-agent answer labelled with the model that produced it', async () => {
    const outcome = await runDelegate({ task: 'Summarise this' }, stub(), new AbortController().signal);
    expect(outcome.isError).toBe(false);
    expect(textOf(outcome.content)).toContain('[P / small]');
    expect(textOf(outcome.content)).toContain('task=Summarise this');
  });

  it('rejects an empty task instead of paying for a guess', async () => {
    const outcome = await runDelegate({ task: '   ' }, stub(), new AbortController().signal);
    expect(outcome.isError).toBe(true);
    expect(textOf(outcome.content)).toContain('non-empty task');
  });

  it('caps the requested output and defaults it', async () => {
    const seen: number[] = [];
    const run = stub({
      async *run(_system, task, maxTokens) { seen.push(maxTokens); yield task; },
    });
    const signal = new AbortController().signal;
    await runDelegate({ task: 'a' }, run, signal);
    await runDelegate({ task: 'b', max_tokens: 500 }, run, signal);
    await runDelegate({ task: 'c', max_tokens: 10 ** 9 }, run, signal);
    await runDelegate({ task: 'd', max_tokens: -5 }, run, signal);
    expect(seen).toEqual([2_000, 500, 16_000, 2_000]);
  });

  it('reports a sub-agent failure as an error result, not a thrown exception', async () => {
    const failing = stub({ async *run() { throw new Error('upstream 500'); } });
    const outcome = await runDelegate({ task: 'x' }, failing, new AbortController().signal);
    expect(outcome.isError).toBe(true);
    expect(textOf(outcome.content)).toContain('upstream 500');
  });

  it('treats an empty answer as a failure so the model does not read silence as success', async () => {
    const silent = stub({ async *run() {} });
    const outcome = await runDelegate({ task: 'x' }, silent, new AbortController().signal);
    expect(outcome.isError).toBe(true);
    expect(textOf(outcome.content)).toContain('returned no text');
  });

  it('stops when the turn is cancelled', async () => {
    const controller = new AbortController();
    const slow = stub({
      async *run() {
        yield 'partial';
        controller.abort();
        yield 'more';
      },
    });
    const outcome = await runDelegate({ task: 'x' }, slow, controller.signal);
    expect(outcome.isError).toBe(true);
    expect(textOf(outcome.content)).toContain('cancelled');
  });
});

describe('sub-agent isolation', () => {
  it('sends only the task and its own system prompt, never the conversation', async () => {
    const calls: Array<{ system: string; messages: unknown }> = [];
    await runDelegate({ task: 'only this' }, {
      modelId: 'm', label: 'P / m',
      async *run(system, task) {
        calls.push({ system, messages: [{ role: 'user', content: [{ type: 'text', text: task }] }] });
        yield 'ok';
      },
    }, new AbortController().signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('focused sub-agent');
    expect(JSON.stringify(calls[0]!.messages)).toContain('only this');
    // No history, no tool definitions: the isolation is the feature.
    expect(JSON.stringify(calls[0]!.messages)).not.toContain('assistant');
  });
});
