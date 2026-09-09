import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../src/llm/anthropic/adapter.js';
import type { LLMRequest } from '../src/llm/types.js';

/** Capture the params the adapter hands to the SDK for a given request. */
async function captured(req: Partial<LLMRequest>, compat: Record<string, unknown> = {}) {
  const adapter = new AnthropicAdapter({ id: 'p', name: 'p', type: 'anthropic', baseUrl: 'http://x', apiKey: 'k', extraHeaders: {}, compat, createdAt: '' });
  let params: Record<string, unknown> | null = null;
  (adapter as unknown as { client: { messages: { stream: (p: unknown) => unknown } } }).client.messages.stream = (p: unknown) => {
    params = p as Record<string, unknown>;
    throw new Error('stop');
  };
  const full: LLMRequest = { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 4000, reasoning: 'off', ...req };
  await expect((async () => { for await (const _ of adapter.stream(full)) void _; })()).rejects.toThrow('stop');
  return params!;
}

describe('AnthropicAdapter request params', () => {
  it('adaptive: thinking adaptive + display, level becomes effort, no temperature', async () => {
    const p = await captured({ reasoning: 'medium', adaptive: true, temperature: 0.5 });
    expect(p.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(p.temperature).toBeUndefined();
    expect(p.output_config).toEqual({ effort: 'medium' });
  });
  it('adaptive without display when compat.thinkingDisplay=false', async () => {
    const p = await captured({ reasoning: 'medium', adaptive: true }, { thinkingDisplay: false });
    expect(p.thinking).toEqual({ type: 'adaptive' });
  });
  it('adaptive: level maps to output_config.effort, minimal defaults to low', async () => {
    const p = await captured({ reasoning: 'high', adaptive: true });
    expect(p.output_config).toEqual({ effort: 'high' });
    const q = await captured({ reasoning: 'minimal', adaptive: true });
    expect(q.output_config).toEqual({ effort: 'low' });
  });
  it('adaptive: reasoningMap overrides / disables a level', async () => {
    const p = await captured({ reasoning: 'max', adaptive: true, reasoningMap: { max: 'high' } });
    expect(p.output_config).toEqual({ effort: 'high' });
    const q = await captured({ reasoning: 'high', adaptive: true, reasoningMap: { high: null } });
    expect(q.output_config).toBeUndefined();
  });
  it('enabled style (gateways): {type:enabled} + display, never budget_tokens', async () => {
    const p = await captured({ reasoning: 'medium', adaptive: false, maxTokens: 4000 });
    expect(p.thinking).toEqual({ type: 'enabled', display: 'summarized' });
    const q = await captured({ reasoning: 'medium', adaptive: false, maxTokens: 64000 }, { thinkingDisplay: false });
    expect(q.thinking).toEqual({ type: 'enabled' });
  });
  it('effort goes to top-level reasoning_effort when compat.effortParam says so (GLM recipe)', async () => {
    const p = await captured({ reasoning: 'low', adaptive: false }, { effortParam: 'reasoning_effort', thinkingDisplay: false });
    expect(p.reasoning_effort).toBe('low');
    expect(p.output_config).toBeUndefined();
    expect(p.thinking).toEqual({ type: 'enabled' });
  });
  it('effort is sent in both thinking styles, at the place the provider configured', async () => {
    const p = await captured({ reasoning: 'high', adaptive: false });
    expect(p.output_config).toEqual({ effort: 'high' });
    const q = await captured({ reasoning: 'high', adaptive: true }, { effortParam: 'reasoning_effort' });
    expect(q.reasoning_effort).toBe('high');
    expect(q.thinking).toMatchObject({ type: 'adaptive' });
  });
  it('off + adaptive: explicit {type:disabled}, temperature passes through', async () => {
    const p = await captured({ reasoning: 'off', adaptive: true, temperature: 0.7 });
    expect(p.thinking).toEqual({ type: 'disabled' });
    expect(p.temperature).toBe(0.7);
  });
  it('off + budget style: thinking param omitted, temperature passes through', async () => {
    const p = await captured({ reasoning: 'off', adaptive: false, temperature: 0.7 });
    expect(p.thinking).toBeUndefined();
    expect(p.temperature).toBe(0.7);
  });
  it('off with reasoningMap.off=null: cannot disable, param omitted even in adaptive mode', async () => {
    const p = await captured({ reasoning: 'off', adaptive: true, reasoningMap: { off: null } });
    expect(p.thinking).toBeUndefined();
  });
});
