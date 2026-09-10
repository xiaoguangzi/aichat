import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../src/llm/openai/adapter.js';
import type { LLMRequest } from '../src/llm/types.js';

/** Capture the params the adapter hands to the SDK for a given request. */
async function captured(req: Partial<LLMRequest>, compat: Record<string, unknown> = {}, baseUrl = 'http://x') {
  const adapter = new OpenAIAdapter({ id: 'p', name: 'p', type: 'openai', baseUrl, apiKey: 'k', extraHeaders: {}, compat, createdAt: '' });
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

const tool = { name: 'demo', description: 'demo', inputSchema: { type: 'object' } };
const history: LLMRequest['messages'] = [
  { role: 'user', content: [{ type: 'text', text: 'first' }] },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'first thought' }, { type: 'text', text: 'answer' }] },
  { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'part1' }, { type: 'thinking', thinking: 'part2' }, { type: 'tool_use', id: 'call', name: 'demo', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content: [{ type: 'text', text: 'result' }], is_error: false }] },
];
describe('official DeepSeek endpoint', () => {
  it.each(['https://api.deepseek.com', 'https://api.deepseek.com/v1/', 'https://api.deepseek.com/beta'])('replays all assistant reasoning with tools at %s', async baseUrl => {
    const p = await captured({ messages: history, tools: [tool], reasoning: 'max' }, {}, baseUrl);
    expect(p.thinking).toEqual({ type: 'enabled' });
    expect(p.reasoning_effort).toBe('max');
    expect(p.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer', reasoning_content: 'first thought' },
      { role: 'user', content: 'follow up' },
      { role: 'assistant', content: null, reasoning_content: 'part1part2', tool_calls: [{ id: 'call', type: 'function', function: { name: 'demo', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call', content: 'result' },
    ]);
  });
  it('explicitly disables thinking and omits reasoning replay without tools', async () => {
    const p = await captured({ messages: history, tools: [], reasoning: 'off' }, {}, 'https://api.deepseek.com/v1');
    expect(p.thinking).toEqual({ type: 'disabled' });
    expect(p.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(p.messages)).not.toContain('reasoning_content');
  });
  it.each([['minimal', 'low'], ['medium', 'high'], ['xhigh', 'high']] as const)('maps %s to %s', async (reasoning, expected) => {
    const p = await captured({ reasoning }, {}, 'https://api.deepseek.com/v1');
    expect(p.reasoning_effort).toBe(expected);
  });
  it('respects explicit effort mappings', async () => {
    const p = await captured({ reasoning: 'max', reasoningMap: { max: 'high' } }, {}, 'https://api.deepseek.com/v1');
    expect(p.reasoning_effort).toBe('high');
  });
  it.each(['https://gateway.example/v1', 'https://api.deepseek.com.example/v1', 'https://example.com/api.deepseek.com', 'http://api.deepseek.com/v1', 'https://api.deepseek.com:8443/v1', 'https://api.deepseek.com/custom'])('preserves custom behavior at %s', async baseUrl => {
    const p = await captured({ messages: history, tools: [tool], reasoning: 'off' }, { thinkingFormat: 'deepseek' }, baseUrl);
    expect(p.thinking).toBeUndefined();
    expect(p.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(p.messages)).not.toContain('reasoning_content');
  });
});
