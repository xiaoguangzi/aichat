import type { Block, ToolDef } from '@aichat/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { toolResultsRepo } from '../db/repos/toolResults.js';

export const READ_RESULT_TOOL = 'context__read_result';
export const readResultTool: ToolDef = {
  name: READ_RESULT_TOOL,
  description: 'Read original text saved from a large tool result in this conversation. Use the result_id from its preview. Read a page with offset, or find literal query matches and surrounding passages. Follow next_offset to continue; absence from a preview is not evidence of absence from the original. Offsets count UTF-16 characters, starting at zero.',
  inputSchema: {
    type: 'object',
    properties: {
      result_id: { type: 'string', description: 'The result_id shown in a tool result preview.' },
      offset: { type: 'integer', minimum: 0, description: 'Starting character offset. Default 0.' },
      limit: { type: 'integer', minimum: 1, maximum: 8000, description: 'Maximum excerpt characters to return. Default 4000.' },
      query: { type: 'string', minLength: 1, maxLength: 200, description: 'Optional case-insensitive literal search, not a regular expression.' },
    },
    required: ['result_id'],
    additionalProperties: false,
  },
};

const readSchema = z.object({
  result_id: z.string().min(1).max(100),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.number().int().min(1).max(8000).default(4000),
  query: z.string().trim().min(1).max(200).optional(),
}).strict();

/** Slice on UTF-16 offsets without cutting a surrogate pair. */
function boundary(text: string, offset: number): number {
  const n = Math.min(offset, text.length);
  return n > 0 && /[\uD800-\uDBFF]/.test(text[n - 1]!) && /[\uDC00-\uDFFF]/.test(text[n] ?? '') ? n - 1 : n;
}

function excerpt(text: string, start: number, size: number): { start: number; end: number; text: string } {
  start = boundary(text, start);
  // Allow a single supplementary character to progress even for limit=1.
  let end = boundary(text, Math.min(text.length, start + size));
  if (end === start && start < text.length) end = Math.min(text.length, start + 2);
  return { start, end, text: text.slice(start, end) };
}

/** Source cards rather than just the first document, for Exa's text search format. */
function searchPreview(text: string, budget: number): string | null {
  const starts = [...text.matchAll(/^Title: .+$/gm)].map(m => m.index!);
  if (starts.length < 2) return null;
  const cards: string[] = [];
  const count = Math.min(starts.length, 8, Math.max(1, Math.floor(budget / 700)));
  const perCard = Math.max(100, Math.floor((budget - 200) / count) - 80);
  for (let i = 0; i < count; i++) {
    const start = starts[i]!;
    const raw = text.slice(start, starts[i + 1] ?? text.length);
    const metadata = raw.split('\n').filter(line => /^(Title|URL|Published|Published Date|Author):/.test(line)).join('\n');
    const body = raw.replace(/^(Title|URL|Published|Published Date|Author):.*\n?/gm, '').trim();
    const head = excerpt(body, 0, Math.max(0, perCard - metadata.length)).text;
    cards.push(`[Source ${i + 1}; offset ${start}]\n${metadata}\n${head}`);
  }
  const result = `${cards.join('\n\n')}\n\nShowing ${count} of ${starts.length} sources; excerpts only.`;
  return result.length <= budget ? result : null;
}

/** Recognize structured search results without changing unknown JSON or inventing facts. */
function jsonSearchPreview(text: string, budget: number): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'results' in parsed ? parsed.results : null;
  if (!Array.isArray(items) || !items.length || !items.every(x => x && typeof x === 'object' && typeof x.url === 'string')) return null;
  const count = Math.min(items.length, 8, Math.max(1, Math.floor(budget / 700)));
  const perCard = Math.max(100, Math.floor((budget - 200) / count) - 80);
  const cards = items.slice(0, count).map((item: Record<string, unknown>, i: number) => {
    const meta = ['title', 'url', 'publishedDate', 'author'].filter(k => typeof item[k] === 'string').map(k => `${k}: ${item[k]}`).join('\n');
    const highlights = Array.isArray(item.highlights) ? item.highlights.filter(x => typeof x === 'string').join('\n') : '';
    const source = highlights || [item.summary, item.text, item.content].find(x => typeof x === 'string') || '';
    return `[Source ${i + 1}]\n${meta}\n${excerpt(String(source), 0, Math.max(0, perCard - meta.length)).text}`;
  });
  const result = `${cards.join('\n\n')}\n\nShowing ${count} of ${items.length} sources; excerpts only. Search the saved original by URL for more.`;
  return result.length <= budget ? result : null;
}

export function previewText(text: string, budget: number): string {
  const search = searchPreview(text, budget) ?? jsonSearchPreview(text, budget);
  if (search) return search;
  const head = excerpt(text, 0, Math.floor((budget - 100) * 0.75));
  const tailStart = Math.max(head.end, text.length - Math.floor((budget - 100) * 0.25));
  const tail = excerpt(text, tailStart, text.length - tailStart);
  return `${head.text}\n\n[Middle omitted; tail starts at offset ${tail.start}]\n\n${tail.text}`;
}

export function resultTextChars(content: Block[]): number {
  const texts = content.filter(b => b.type === 'text');
  return texts.reduce((n, b) => n + b.text.length, 0) + Math.max(0, texts.length - 1) * 2;
}

/** Runs once, before persistence/SSE. Replaying history never generates a fresh preview. */
export function prepareToolResult(conversationId: string, name: string, content: Block[], budget = config.toolResultPreviewChars): { content: Block[]; resultId?: string } {
  const texts = content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text');
  const original = texts.map(b => b.text).join('\n\n');
  if (original.length <= budget && original.length <= config.toolResultHistoryKeepChars) return { content };
  const resource = toolResultsRepo.create(conversationId, name, original);
  // Save medium results too: later compaction must not force another external search.
  if (original.length <= budget) return { content, resultId: resource.id };
  const notice = `Tool result preview (excerpts, not the complete result). Original saved locally.\nresult_id: ${resource.id}\ntotal_chars: ${original.length}\nUse ${READ_RESULT_TOOL} with result_id and offset/limit or query to read more. Verify omitted details before making claims.\n\n`;
  const preview = notice + previewText(original, Math.max(200, budget - notice.length));
  let inserted = false;
  const blocks = content.flatMap<Block>(b => {
    if (b.type !== 'text') return [b]; // Keep images and other media intact.
    if (inserted) return [];
    inserted = true;
    return [{ type: 'text' as const, text: preview }];
  });
  return { content: blocks, resultId: resource.id };
}

/** Fair deterministic allocation: fast parallel calls cannot consume another call's budget. */
export function allocateToolResultBudgets(sizes: number[], total = config.toolResultBatchChars): number[] {
  const budgets = sizes.map(n => Math.min(n, config.toolResultPreviewChars));
  if (budgets.reduce((a, b) => a + b, 0) <= total) return budgets;
  // Each call needs room for a reference and useful excerpt; enormous batches may exceed total.
  const floor = config.toolResultMinChars;
  let remaining = Math.max(total, sizes.reduce((n, s) => n + Math.min(s, floor), 0));
  const pending = new Set(sizes.map((_, i) => i));
  while (pending.size) {
    const share = Math.floor(remaining / pending.size);
    const small = [...pending].filter(i => budgets[i]! <= share);
    if (!small.length) {
      for (const i of pending) budgets[i] = share;
      break;
    }
    for (const i of small) { remaining -= budgets[i]!; pending.delete(i); }
  }
  return budgets;
}

export function readToolResult(conversationId: string, input: unknown, maxChars = config.toolResultPreviewChars): { content: Block[]; isError: boolean } {
  const parsed = readSchema.safeParse(input);
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
  if (!parsed.success) return fail(`Invalid read arguments: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const { result_id: id, offset, limit, query } = parsed.data;
  const resource = toolResultsRepo.get(conversationId, id);
  if (!resource) return fail('Saved tool result not found in this conversation.');
  const text = resource.text;
  if (offset > text.length) return fail(`offset exceeds total_chars (${text.length}).`);
  const render = (size: number): string => {
    let payload: Record<string, unknown>;
    if (query) {
      // Escaped Unicode regexp preserves original offsets even when case folding changes length.
      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
      re.lastIndex = offset;
      const matches: Array<{ match_offset: number; start: number; end: number; text: string }> = [];
      let left = size;
      let next: number | null = null;
      while (left > 0 && matches.length < 5) {
        const match = re.exec(text);
        if (!match) { next = null; break; }
        const part = excerpt(text, Math.max(0, match.index - Math.min(120, Math.floor(Math.max(0, left - query.length) / 4))), Math.min(left, 1000));
        matches.push({ match_offset: match.index, ...part });
        left -= part.text.length;
        next = re.lastIndex;
      }
      // Look ahead without consuming the next match, so a terminal page reports completion.
      if (next !== null && !re.exec(text)) next = null;
      payload = { result_id: id, total_chars: text.length, query, matches, next_offset: next };
    } else {
      const page = excerpt(text, offset, size);
      payload = { result_id: id, total_chars: text.length, ...page, next_offset: page.end < text.length ? page.end : null };
    }
    return JSON.stringify(payload);
  };
  let size = Math.min(limit, Math.max(1, maxChars - 700));
  let output = render(size);
  // JSON escaping also counts toward the wire budget (logs often contain many newlines).
  while (output.length > maxChars && size > 1) {
    size = Math.max(1, Math.floor(size * 0.7));
    output = render(size);
  }
  return { content: [{ type: 'text', text: output }], isError: false };
}
