import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../src/llm/openai/adapter.js';
import type { LLMRequest } from '../src/llm/types.js';

/** Capture the params the adapter hands to the SDK for a given request. */
async function captured(req: Partial<LLMRequest>, compat: Record<string, unknown> = {}) {
  const adapter = new OpenAIAdapter({ id: 'p', name: 'p', type: 'openai', baseUrl: 'http://x', apiKey: 'k', extraHeaders: {}, compat, createdAt: '' });
  let params: Record<string, unknown> | null = null;
  (adapter as unknown as { client: { chat: { completions: { create: (p: unknown) => { withResponse: () => Promise<never> } } } } }).client.chat.completions.create = (p: unknown) => {
    params = p as Record<string, unknown>;
    return { withResponse: () => Promise.reject(new Error('stop')) };
  };
  const full: LLMRequest = { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 4000, reasoning: 'off', ...req };
  await expect((async () => { for await (const _ of adapter.stream(full)) void _; })()).rejects.toThrow('stop');
  return params!;
}

describe('OpenAIAdapter reasoning dialects', () => {
  it('openai dialect (default): top-level reasoning_effort, nothing when off', async () => {
    const p = await captured({ reasoning: 'xhigh' });
    expect(p.reasoning_effort).toBe('xhigh');
    const q = await captured({ reasoning: 'off' });
    expect(q.reasoning_effort).toBeUndefined();
  });
  it('legacy openaiThinkingObject compat behaves like the zai dialect', async () => {
    const p = await captured({ reasoning: 'medium' }, { openaiThinkingObject: true });
    expect(p.thinking).toEqual({ type: 'enabled' });
    expect(p.reasoning_effort).toBe('medium');
    const q = await captured({ reasoning: 'off' }, { openaiThinkingObject: true });
    expect(q.thinking).toEqual({ type: 'disabled' });
    expect(q.reasoning_effort).toBeUndefined();
  });
  it('openrouter dialect: nested reasoning object', async () => {
    const p = await captured({ reasoning: 'high' }, { thinkingFormat: 'openrouter' });
    expect(p.reasoning).toEqual({ effort: 'high' });
    expect(p.reasoning_effort).toBeUndefined();
  });
  it('zai dialect: thinking object + reasoning_effort', async () => {
    const p = await captured({ reasoning: 'low' }, { thinkingFormat: 'zai' });
    expect(p.thinking).toEqual({ type: 'enabled' });
    expect(p.reasoning_effort).toBe('low');
  });
  it('qwen dialect: enable_thinking flag', async () => {
    const p = await captured({ reasoning: 'high' }, { thinkingFormat: 'qwen' });
    expect(p.enable_thinking).toBe(true);
    expect(p.reasoning_effort).toBeUndefined();
    const q = await captured({ reasoning: 'off' }, { thinkingFormat: 'qwen' });
    expect(q.enable_thinking).toBe(false);
  });
  it('deepseek dialect: thinking object when on, nothing when off', async () => {
    const p = await captured({ reasoning: 'high' }, { thinkingFormat: 'deepseek' });
    expect(p.thinking).toEqual({ type: 'enabled' });
    const q = await captured({ reasoning: 'off' }, { thinkingFormat: 'deepseek' });
    expect(q.thinking).toBeUndefined();
  });
  it('reasoningMap remaps the effort literal', async () => {
    const p = await captured({ reasoning: 'max', reasoningMap: { max: 'high' } });
    expect(p.reasoning_effort).toBe('high');
    const q = await captured({ reasoning: 'medium', reasoningMap: { medium: null } });
    expect(q.reasoning_effort).toBeUndefined();
  });
});
