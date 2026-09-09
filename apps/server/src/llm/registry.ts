import type { LLMAdapter } from './types.js';
import type { ProviderSecret } from '../db/repos/providers.js';
import { AnthropicAdapter } from './anthropic/adapter.js';
import { OpenAIAdapter } from './openai/adapter.js';
import { splitInlineThinking } from './thinkTags.js';

const cache = new Map<string, { key: string; adapter: LLMAdapter }>();

function cacheKey(p: ProviderSecret): string {
  return JSON.stringify([p.type, p.baseUrl, p.apiKey, p.extraHeaders, p.compat]);
}

export function getAdapter(p: ProviderSecret): LLMAdapter {
  const key = cacheKey(p);
  const hit = cache.get(p.id);
  if (hit && hit.key === key) return hit.adapter;
  const base = p.type === 'anthropic' ? new AnthropicAdapter(p) : new OpenAIAdapter(p);
  // Reasoning leaked into the answer text is a gateway quirk, not a protocol one, so the
  // filter wraps either adapter. compat.inlineThinkTags: false opts a provider out.
  const adapter: LLMAdapter =
    p.compat.inlineThinkTags === false
      ? base
      : { type: base.type, listModels: () => base.listModels(), stream: (req) => splitInlineThinking(base.stream(req)) };
  cache.set(p.id, { key, adapter });
  return adapter;
}

export function evictAdapter(providerId: string) {
  cache.delete(providerId);
}
