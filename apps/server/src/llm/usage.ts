import type { Usage } from '@aichat/shared';

const count = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

export function openAIUsage(raw: Record<string, unknown>): Usage {
  const details = raw.prompt_tokens_details as Record<string, unknown> | undefined;
  const input = count(raw.prompt_tokens);
  const output = count(raw.completion_tokens);
  const cacheRead = count(details?.cached_tokens);
  return {
    input: input ?? 0, output: output ?? 0, cacheRead,
    inputTotalKnown: input !== undefined,
    usageComplete: input !== undefined && output !== undefined,
    inputUncached: input !== undefined && cacheRead !== undefined ? Math.max(0, input - cacheRead) : undefined,
  };
}

export function anthropicUsage(raw: Record<string, unknown>): Usage {
  const uncached = count(raw.input_tokens);
  const output = count(raw.output_tokens);
  const cacheRead = count(raw.cache_read_input_tokens);
  const cacheWrite = count(raw.cache_creation_input_tokens);
  return {
    input: (uncached ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0), output: output ?? 0,
    inputUncached: uncached, cacheRead, cacheWrite,
    inputTotalKnown: uncached !== undefined && cacheRead !== undefined && cacheWrite !== undefined,
    usageComplete: uncached !== undefined && output !== undefined,
  };
}
