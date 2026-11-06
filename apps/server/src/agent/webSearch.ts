import type { Block, ToolDef } from '@aichat/shared';
import { isExaServer, isOfficialDeepSeekOrigin } from '@aichat/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { mcpServersRepo } from '../db/repos/mcpServers.js';
import { providersRepo } from '../db/repos/providers.js';
import { sanitizeToolName } from '../llm/tools.js';

/**
 * DeepSeek's official Search / Fetch API as the fallback for Exa.
 *
 * The tools are offered whenever web search is on for the conversation (an Exa server is enabled
 * and allowed) and a DeepSeek provider has a key, so the tool list stays the same whether or not Exa
 * is currently limited — swapping tools mid-conversation would rewrite the cached prompt prefix.
 * The model is steered to them by their descriptions and by the notice appended to a rate-limited
 * Exa result. https://api-docs.deepseek.com/zh-cn/guides/search
 */
export const DEEPSEEK_SEARCH_TOOL = 'web__deepseek_search';
export const DEEPSEEK_FETCH_TOOL = 'web__deepseek_fetch';
const API = 'https://api.deepseek.com/v1/tools';

export const deepseekSearchTools: ToolDef[] = [
  {
    name: DEEPSEEK_SEARCH_TOOL,
    description: 'Fallback web search through DeepSeek\'s official Search API. Use it when the Exa search tool reports a rate limit or is unavailable; otherwise prefer Exa. Returns ranked sources with title, URL, date and a summary. Query syntax: "exact phrase", -word, site:example.com, -site:example.com, lang:zh,en, after:2026-01-01, before:2026.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 128, description: 'Search query, at most 128 characters.' },
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results. Default 8.' },
        question: { type: 'string', maxLength: 128, description: 'Optional: the user\'s original question, to improve ranking.' },
        include_content: { type: 'boolean', description: 'Also return full page text. Default false; summaries are usually enough.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: DEEPSEEK_FETCH_TOOL,
    description: 'Fallback page reader through DeepSeek\'s official Fetch API. Use it when the Exa fetch tool reports a rate limit or is unavailable; otherwise prefer Exa. Returns the page title and Markdown text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An http(s) URL without credentials.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

export const isDeepseekSearchTool = (name: string) => name === DEEPSEEK_SEARCH_TOOL || name === DEEPSEEK_FETCH_TOOL;

/** Key of the first provider on DeepSeek's official host. Server-internal; never sent to the client. */
function deepseekKey(): string | null {
  return providersRepo.list().find((p) => p.apiKey && isOfficialDeepSeekOrigin(p.baseUrl))?.apiKey ?? null;
}

const exaServers = (allowed: string[] | 'all') =>
  mcpServersRepo.list().filter((s) => s.enabled && isExaServer(s) && (allowed === 'all' || allowed.includes(s.name)));

/**
 * Follows the web search switch: no Exa enabled for this conversation means no web search at all.
 * Exa being disconnected still counts, so the fallback also covers an Exa outage.
 */
export function fallbackSearchTools(allowed: string[] | 'all'): ToolDef[] {
  return exaServers(allowed).length && deepseekKey() ? deepseekSearchTools : [];
}

const RATE_LIMIT_RE = /rate[\s_-]?limit|too many requests|\b429\b/i;

/**
 * Exa's hosted MCP reports its free-tier limit as an ordinary, non-error text result. A real search
 * result can discuss rate limits too, so only error results or short replies without source cards
 * count.
 */
export function isRateLimited(outcome: { content: Block[]; isError: boolean }): boolean {
  const text = outcome.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  if (!RATE_LIMIT_RE.test(text)) return false;
  return outcome.isError || (text.length <= 2000 && !/^URL: /m.test(text));
}

export function isExaTool(name: string): boolean {
  return mcpServersRepo.list().some((s) => isExaServer(s) && name.startsWith(sanitizeToolName(`mcp__${s.name}__`)));
}

/** Marks a rate-limited Exa result as failed and points the model at the fallback. */
export function withRateLimitFallback(outcome: { content: Block[]; isError: boolean }): { content: Block[]; isError: boolean } {
  return {
    isError: true,
    content: [...outcome.content, {
      type: 'text',
      text: `Exa is rate-limited right now. Continue with ${DEEPSEEK_SEARCH_TOOL} (and ${DEEPSEEK_FETCH_TOOL} for pages) instead of retrying Exa.`,
    }],
  };
}

const searchSchema = z.object({
  query: z.string().trim().min(1).max(128),
  count: z.number().int().min(1).max(20).default(8),
  question: z.string().trim().max(128).nullish(),
  include_content: z.boolean().default(false),
}).strict();
const fetchSchema = z.object({ url: z.url({ protocol: /^https?$/ }).max(8192) }).strict();

interface SearchItem {
  title?: string;
  url?: string;
  summary?: string;
  snippet?: string;
  content?: string;
  site_name?: string | null;
  date?: string | null;
}

/** Same `Title:`/`URL:` card layout as Exa, so large results get the same source-card previews. */
function formatResults(items: SearchItem[]): string {
  return items.map((r) => {
    const lines = [`Title: ${r.title || '(untitled)'}`, `URL: ${r.url ?? ''}`];
    if (r.date) lines.push(`Published: ${r.date}`);
    if (r.site_name) lines.push(`Site: ${r.site_name}`);
    const summary = r.summary || r.snippet;
    if (summary) lines.push(`Summary:\n${summary.trim()}`);
    if (r.content) lines.push(`Content:\n${r.content.trim()}`);
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

const STATUS_HINT: Record<number, string> = {
  401: 'the DeepSeek API key is missing or invalid; check the DeepSeek provider in Settings',
  402: 'the DeepSeek account balance is insufficient',
  403: 'the page was refused by DeepSeek\'s security policy',
  404: 'no usable page content could be fetched',
  429: 'DeepSeek\'s rate limit was reached; wait briefly before retrying',
};

const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

async function call(path: 'search' | 'fetch', body: unknown, key: string, signal: AbortSignal): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.toolTimeoutMs)]),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* reported below */ }
  if (res.ok && data && typeof data === 'object') return { ok: true, data };
  const upstream = (data as { error?: { message?: unknown } } | null)?.error?.message;
  const detail = typeof upstream === 'string' ? upstream : text.slice(0, 300);
  const hint = STATUS_HINT[res.status];
  return { ok: false, message: `DeepSeek ${path} failed (HTTP ${res.status})${hint ? `: ${hint}` : ''}.${detail ? `\n${detail}` : ''}` };
}

export async function runDeepseekTool(name: string, input: unknown, signal: AbortSignal): Promise<{ content: Block[]; isError: boolean }> {
  const key = deepseekKey();
  if (!key) return fail('DeepSeek search needs a provider on https://api.deepseek.com with an API key.');
  const invalid = (e: z.ZodError) => fail(`Invalid arguments: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

  if (name === DEEPSEEK_SEARCH_TOOL) {
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { query, count, question, include_content } = parsed.data;
    const r = await call('search', { query, count, ...(question && { ori_question: question }), need_content: include_content }, key, signal);
    if (!r.ok) return fail(r.message);
    const items = (r.data as { results?: unknown }).results;
    if (!Array.isArray(items)) return fail('DeepSeek search returned an unexpected response.');
    if (!items.length) return { content: [{ type: 'text', text: `No results for: ${query}` }], isError: false };
    return { content: [{ type: 'text', text: formatResults(items as SearchItem[]) }], isError: false };
  }

  const parsed = fetchSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = await call('fetch', { url: parsed.data.url }, key, signal);
  if (!r.ok) return fail(r.message);
  const { title, content } = r.data as { title?: unknown; content?: unknown };
  if (typeof content !== 'string' || !content.trim()) return fail('DeepSeek fetch returned no page content.');
  const head = [typeof title === 'string' && title ? `Title: ${title}` : '', `URL: ${parsed.data.url}`].filter(Boolean).join('\n');
  return { content: [{ type: 'text', text: `${head}\n\n${content.trim()}` }], isError: false };
}
