import type { Block, ProviderType } from '@aichat/shared';
import { config } from '../config.js';
import type { LLMMessage } from '../llm/types.js';
import { READ_RESULT_TOOL } from './toolResults.js';

type TextBlock = Extract<Block, { type: 'text' }>;
type ToolResultBlock = Extract<Block, { type: 'tool_result' }>;

/** The result_id a preview notice or read page carries, so a cleared result stays re-readable. */
function savedResultId(text: string): string | null {
  return (/^result_id: (\S+)$/m.exec(text)?.[1] ?? /"result_id"\s*:\s*"([^"]+)"/.exec(text)?.[1]) ?? null;
}

function clearOldToolResult(b: ToolResultBlock): ToolResultBlock {
  const texts = b.content.filter((x): x is TextBlock => x.type === 'text');
  const joined = texts.map(x => x.text).join('\n\n');
  const media = b.content.length - texts.length;
  if (joined.length > config.toolResultHistoryKeepChars) {
    const id = b.resultId ?? savedResultId(joined);
    const size = /^total_chars: (\d+)$/m.exec(joined)?.[1] ?? String(joined.length);
    const placeholder = id
      ? `[Old tool result cleared from context (total_chars: ${size}). Original saved locally; use ${READ_RESULT_TOOL} with result_id: ${id} (offset/limit or query) to read it again.]`
      : `[Old tool result cleared from context (total_chars: ${size}). Head of original: ${joined.slice(0, 200).trim()}]`;
    return { ...b, content: [{ type: 'text', text: placeholder }] };
  }
  if (!media) return b;
  // Small text stays inline; media is the expensive part and its current-turn copy is long gone.
  return { ...b, content: [...texts, { type: 'text', text: `[${media} media attachment(s) removed from this old tool result.]` }] };
}

function shapeOldMessage(m: LLMMessage, preserveThinking: boolean): LLMMessage {
  if (m.role === 'assistant') {
    if (preserveThinking) return m;
    const content = m.content.filter(b => b.type !== 'thinking');
    return content.length === m.content.length ? m : { role: m.role, content };
  }
  let changed = false;
  const content = m.content.map(b => {
    if (b.type !== 'tool_result') return b;
    const shaped = clearOldToolResult(b);
    if (shaped !== b) changed = true;
    return shaped;
  });
  return changed ? { role: m.role, content } : m;
}

function replayCost(m: LLMMessage, protocol: ProviderType): number {
  return m.content.reduce((total, b) => {
    if (b.type === 'thinking') return total + (protocol === 'anthropic' ? b.thinking.length + (b.signature?.length ?? 0) : 0);
    if (b.type !== 'tool_result') return total;
    return total + b.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 8_000), 0);
  }, 0);
}

/** Replay compaction decisions at historical user boundaries. Appending messages cannot
 * undo an earlier compaction, even after a restart. Keep prefixes intact below the high
 * watermark; above it, compact oldest complete turns down to the low watermark. Current
 * tool loops and user/assistant prose are never compacted. Media cost is a rough weight,
 * not a tokenizer or a model context-window guarantee. */
export function shapeOldTurns(messages: LLMMessage[], protocol: ProviderType = 'anthropic', preserveThinking = false): LLMMessage[] {
  const out: LLMMessage[] = [];
  const turns: Array<{ start: number; end: number }> = [];
  let start = 0;
  let next = 0;
  let cost = 0;
  for (const m of messages) {
    if (m.role === 'user' && m.content.some(b => b.type !== 'tool_result')) {
      if (out.length > start) turns.push({ start, end: out.length });
      start = out.length;
      if (cost > config.historyHighWaterChars) {
        while (cost > config.historyLowWaterChars && next < turns.length) {
          const turn = turns[next++]!;
          for (let i = turn.start; i < turn.end; i++) {
            const before = out[i]!;
            const after = shapeOldMessage(before, preserveThinking);
            cost += replayCost(after, protocol) - replayCost(before, protocol);
            out[i] = after;
          }
        }
      }
    }
    out.push(m);
    cost += replayCost(m, protocol);
  }
  return out;
}
