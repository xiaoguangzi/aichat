import { describe, expect, it } from 'vitest';
import { TurnTimer } from '../src/agent/timing.js';

describe('turn timing', () => {
  it('counts first reasoning output, excludes each wait and tools from generation, and includes them in total', () => {
    let now = 0;
    const timer = new TurnTimer(() => now);
    timer.startCall();
    now = 100;
    timer.observe({ type: 'text_delta', text: '' });
    timer.observe({ type: 'thinking_delta', text: '', signature: 'sig' });
    timer.observe({ type: 'usage', usage: { input: 10, output: 0 } });
    now = 500;
    timer.observe({ type: 'thinking_delta', text: 'thinking' });
    now = 1500;
    timer.finishCall({ input: 10, output: 50 });
    now = 6500; // tool execution
    timer.startCall();
    now = 7000;
    timer.observe({ type: 'text_delta', text: 'answer' });
    now = 9000;
    timer.finishCall({ input: 20, output: 100 });
    expect(timer.snapshot()).toEqual({ firstTokenMs: 500, totalMs: 9000, generationMs: 3000, outputTokens: 150, outputComplete: true });
  });

  it('retains missing usage across later calls and includes time spent stopping in a tool', () => {
    let now = 0;
    const timer = new TurnTimer(() => now);
    timer.startCall();
    now = 200;
    timer.observe({ type: 'tool_call_start', id: 't', name: 'test' });
    now = 400;
    timer.finishCall(null);
    now = 5400;
    expect(timer.snapshot()).toMatchObject({ firstTokenMs: 200, totalMs: 5400, generationMs: 200, outputComplete: false });
    timer.startCall();
    timer.observe({ type: 'text_delta', text: 'done' });
    now = 6000;
    timer.finishCall({ input: 10, output: 5 });
    expect(timer.snapshot().outputComplete).toBe(false);
  });

  it('does not invent a first token when an attempt fails before output', () => {
    let now = 0;
    const timer = new TurnTimer(() => now);
    timer.startCall();
    now = 1000;
    timer.finishCall(null);
    expect(timer.snapshot()).toEqual({ firstTokenMs: undefined, totalMs: 1000, generationMs: 0, outputTokens: 0, outputComplete: false });
  });
});
