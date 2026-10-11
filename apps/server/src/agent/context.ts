import type { Block, ContextEstimate, ToolDef } from '@aichat/shared';

/**
 * Character classes are charged at different rates because byte-per-token differs by script: a
 * JSON-ish ASCII payload runs ~4 chars/token, while CJK is close to one token per character. This
 * is a heuristic for budgeting, not a tokenizer: it never claims an exact window and the UI labels
 * it as an estimate. It is deliberately deterministic so the same history always reports the same
 * number (no per-request drift while streaming).
 */
const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 1.5;
/** Every message carries role/serialization overhead even when its text is short. */
const PER_MESSAGE_TOKENS = 4;
/** A tool definition is a name, a description and a schema, plus protocol wrapping. */
const PER_TOOL_TOKENS = 8;

/** ASCII pays ~4 chars/token; everything else (CJK, emoji, accents) pays closer to 1.5. */
function splitByClass(text: string) {
  let ascii = 0;
  let wide = 0;
  for (const char of text) {
    // Iterating a string yields code points, so a surrogate pair counts once.
    if (char.charCodeAt(0) < 128) ascii += 1;
    else wide += 1;
  }
  return { ascii, wide };
}

export function estimateText(text: string): number {
  if (!text) return 0;
  const { ascii, wide } = splitByClass(text);
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + wide / NON_ASCII_CHARS_PER_TOKEN);
}

/** Rough media weight. Images are re-encoded per provider, so an exact count is not available. */
const IMAGE_TOKENS = 1_600;
const DOCUMENT_TOKENS_PER_KB = 250;

export function estimateBlock(block: Block): number {
  switch (block.type) {
    case 'text':
      return estimateText(block.text);
    case 'thinking':
      // Thinking is replayed only where the protocol requires it, but it still occupies the budget
      // of the request that produced it, which is what the occupancy bar shows.
      return estimateText(block.thinking) + estimateText(block.signature ?? '');
    case 'tool_use':
      return estimateText(block.name) + estimateText(JSON.stringify(block.input ?? {}));
    case 'tool_result':
      return block.content.reduce((sum, part) => sum + estimateBlock(part), 0);
    case 'image':
      return IMAGE_TOKENS;
    case 'document':
      return Math.ceil((block.data ? block.data.length * 0.75 : 4_096) / 1024 * DOCUMENT_TOKENS_PER_KB);
    default:
      return 0;
  }
}

export function estimateMessages(messages: { content: Block[] }[]): number {
  return messages.reduce(
    (sum, message) => sum + PER_MESSAGE_TOKENS + message.content.reduce((n, b) => n + estimateBlock(b), 0),
    0,
  );
}

export function estimateTools(tools: ToolDef[] | undefined): number {
  if (!tools?.length) return 0;
  return tools.reduce(
    (sum, tool) => sum + PER_TOOL_TOKENS + estimateText(tool.name) + estimateText(tool.description ?? '') +
      estimateText(JSON.stringify(tool.inputSchema ?? {})),
    0,
  );
}

/**
 * Breakdown of what the next request would carry. `history` is the request actually assembled, so
 * the number describes a real payload rather than a guess about future messages.
 */
export function estimateContext(input: {
  system?: string;
  messages: { content: Block[] }[];
  tools?: ToolDef[];
  /** Model-declared window. Null when the user has not declared one. */
  contextWindow?: number | null;
  /** Tokens already counted as produced in this turn (visible as headroom). */
  reservedOutput?: number;
}): ContextEstimate {
  const system = estimateText(input.system ?? '');
  const tools = estimateTools(input.tools);
  const history = estimateMessages(input.messages);
  const total = system + tools + history;
  const window = input.contextWindow && input.contextWindow > 0 ? input.contextWindow : null;
  const reserved = Math.max(0, input.reservedOutput ?? 0);
  return {
    system,
    tools,
    history,
    total,
    // Without a declared window there is no honest denominator, so `budget` stays null and the UI
    // shows the raw count instead of a fabricated percentage.
    budget: window,
    reservedOutput: reserved,
    ratio: window ? Math.min(1, (total + reserved) / window) : null,
  };
}
