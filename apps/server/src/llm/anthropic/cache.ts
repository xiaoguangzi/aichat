import type Anthropic from '@anthropic-ai/sdk';
import type { ProviderCompat } from '@aichat/shared';

/** Match endpoint capabilities, never model names. Unknown gateways keep their existing wire format. */
export function supportsPromptCaching(baseUrl: string, mode: ProviderCompat['promptCaching']): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  try { return ['api.anthropic.com', 'zenmux.ai'].includes(new URL(baseUrl).hostname); }
  catch { return false; }
}

/** Explicit breakpoints work on both documented endpoints; use standard 5m writes.
 * The previous user breakpoint keeps long parallel tool batches within the lookback limit.
 * Mutate only fresh protocol params, never persisted canonical messages or tool schemas. */
export function applyPromptCaching(params: Anthropic.MessageStreamParams): void {
  if (typeof params.system === 'string' && params.system) {
    params.system = [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }];
  } else if (params.tools?.length) {
    const index = params.tools.length - 1;
    params.tools[index] = { ...params.tools[index]!, cache_control: { type: 'ephemeral' } };
  }
  let marked = 0;
  for (let i = params.messages.length - 1; i >= 0 && marked < 2; i--) {
    const msg = params.messages[i]!;
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      if (!msg.content) continue;
      msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }];
      marked++;
    } else {
      const last = msg.content.length - 1;
      const block = msg.content[last];
      if (!block || !['text', 'image', 'document', 'tool_result'].includes(block.type)) continue;
      msg.content[last] = { ...block, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
      marked++;
    }
  }
}
