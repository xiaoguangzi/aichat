import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent } from '@aichat/shared';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-websearch-'));
process.env.DATA_DIR = tmp;
process.env.SKILLS_DIR = path.join(tmp, 'skills');

const EXA_LIMIT = "You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key.\n\nFix: Create API key at https://dashboard.exa.ai/api-keys , and then update Exa MCP URL to this https://mcp.exa.ai/mcp?exaApiKey=YOUR_EXA_API_KEY";

// The model searches with Exa, gets the rate-limit reply, then switches to DeepSeek search.
const calls: Array<{ tools: Array<{ name: string }>; messages: unknown[] }> = [];
vi.mock('../src/llm/registry.js', () => ({
  getAdapter: () => ({
    type: 'openai',
    listModels: async () => [],
    async *stream(req: { tools: Array<{ name: string }>; messages: unknown[] }): AsyncIterable<StreamEvent> {
      calls.push({ tools: req.tools, messages: [...req.messages] });
      if (calls.length === 1) {
        yield { type: 'tool_call_start', id: 't1', name: 'mcp__exa__web_search_exa' };
        yield { type: 'tool_call_end', id: 't1', input: { query: 'aichat' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else if (calls.length === 2) {
        yield { type: 'tool_call_start', id: 't2', name: 'web__deepseek_search' };
        yield { type: 'tool_call_end', id: 't2', input: { query: 'aichat' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'text_delta', text: 'answer' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
  }),
  evictAdapter: () => {},
}));
let exaReply = EXA_LIMIT;
vi.mock('../src/mcp/manager.js', () => ({
  mcpManager: {
    toolDefs: () => [{ name: 'mcp__exa__web_search_exa', description: 'search', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [{ type: 'text', text: exaReply }], isError: false }),
  },
}));

const { initDb, closeDb } = await import('../src/db/database.js');
const { ensureDirs } = await import('../src/config.js');
const { providersRepo, modelsRepo } = await import('../src/db/repos/providers.js');
const { mcpServersRepo } = await import('../src/db/repos/mcpServers.js');
const { conversationsRepo } = await import('../src/db/repos/conversations.js');
const { messagesRepo } = await import('../src/db/repos/messages.js');
const { runAgent } = await import('../src/agent/loop.js');
const { fallbackSearchTools, isRateLimited, runDeepseekTool } = await import('../src/agent/webSearch.js');

const deepseekResult = {
  title: 'DeepSeek 上线网页搜索与抓取 API',
  url: 'https://example.com/news',
  summary: 'Search / Fetch API 已正式上线。',
  snippet: 'short',
  content: '',
  site_name: 'IT之家',
  date: '2026-10-16T16:00:00+00:00',
  authority: 3,
  rerank_score: 2.4,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;

beforeEach(() => {
  calls.length = 0;
  exaReply = EXA_LIMIT;
  ensureDirs();
  initDb(path.join(tmp, `t-${Date.now()}-${Math.random()}.db`));
});
afterEach(() => {
  closeDb();
  vi.unstubAllGlobals();
});

const addExa = (over: Partial<{ enabled: boolean; name: string }> = {}) =>
  mcpServersRepo.create({ name: 'exa', transport: 'http', url: 'https://mcp.exa.ai/mcp', ...over });
const addDeepseek = (apiKey = 'sk-ds', baseUrl = 'https://api.deepseek.com/v1') =>
  providersRepo.create({ name: 'any name', type: 'openai', baseUrl, apiKey });

describe('fallback availability', () => {
  it('follows the Exa switch and needs a key on the official DeepSeek host', () => {
    expect(fallbackSearchTools('all')).toEqual([]);
    addExa();
    expect(fallbackSearchTools('all')).toEqual([]);
    addDeepseek('', 'https://api.deepseek.com');
    providersRepo.create({ name: 'DeepSeek', type: 'openai', baseUrl: 'https://gateway.example.com/deepseek', apiKey: 'k' });
    expect(fallbackSearchTools('all')).toEqual([]);
    providersRepo.create({ name: 'gw', type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k' });
    expect(fallbackSearchTools('all').map(t => t.name)).toEqual(['web__deepseek_search', 'web__deepseek_fetch']);
    // Per-conversation MCP allowlist: excluding Exa also excludes its fallback.
    expect(fallbackSearchTools(['filesystem'])).toEqual([]);
    expect(fallbackSearchTools(['exa'])).toHaveLength(2);
  });

  it('is off when web search is switched off', () => {
    addExa({ enabled: false });
    addDeepseek();
    expect(fallbackSearchTools('all')).toEqual([]);
  });
});

describe('rate-limit detection', () => {
  const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });
  it('recognizes Exa\'s non-error limit reply and HTTP 429 errors', () => {
    expect(isRateLimited(text(EXA_LIMIT))).toBe(true);
    expect(isRateLimited(text('MCP error -32603: Request failed with status code 429', true))).toBe(true);
    expect(isRateLimited(text('Too Many Requests'))).toBe(true);
  });
  it('does not mistake search results about rate limits for a failure', () => {
    expect(isRateLimited(text('Title: API rate limits explained\nURL: https://example.com\nHighlights:\nA rate limit caps requests.'))).toBe(false);
    expect(isRateLimited(text(`Rate limits guide\n${'body '.repeat(600)}`))).toBe(false);
    expect(isRateLimited(text('connection reset', true))).toBe(false);
  });
});

describe('DeepSeek tools', () => {
  it('sends a search with the provider key and formats Exa-style source cards', async () => {
    addDeepseek();
    const net = vi.fn(async (_url: string, _init: RequestInit) => json({ results: [deepseekResult, { ...deepseekResult, url: 'https://example.com/2', summary: '', date: null, site_name: null }] }));
    vi.stubGlobal('fetch', net);
    const r = await runDeepseekTool('web__deepseek_search', { query: ' DeepSeek search ', question: '有什么新功能？' }, signal());
    const [url, init] = net.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-ds');
    expect(JSON.parse(String(init.body))).toEqual({ query: 'DeepSeek search', count: 8, ori_question: '有什么新功能？', need_content: false });
    expect(r.isError).toBe(false);
    const out = (r.content[0] as { text: string }).text;
    expect(out).toContain('Title: DeepSeek 上线网页搜索与抓取 API\nURL: https://example.com/news\nPublished: 2026-10-16T16:00:00+00:00\nSite: IT之家\nSummary:\nSearch / Fetch API 已正式上线。');
    // Falls back to the short snippet when the long summary is empty.
    expect(out).toContain('URL: https://example.com/2\nSummary:\nshort');
  });

  it('reports empty results, bad arguments and upstream errors without calling twice', async () => {
    addDeepseek();
    const net = vi.fn(async () => json({ results: [] }));
    vi.stubGlobal('fetch', net);
    expect(await runDeepseekTool('web__deepseek_search', { query: 'nothing' }, signal())).toEqual({ content: [{ type: 'text', text: 'No results for: nothing' }], isError: false });
    const tooLong = await runDeepseekTool('web__deepseek_search', { query: 'x'.repeat(129) }, signal());
    expect(tooLong.isError).toBe(true);
    expect(net).toHaveBeenCalledTimes(1);
    net.mockResolvedValueOnce(json({ error: { message: 'Rate limit reached', type: 'rate_limit_error', param: null, code: 'rate_limit' } }, 429));
    const limited = await runDeepseekTool('web__deepseek_search', { query: 'x' }, signal());
    expect(limited.isError).toBe(true);
    expect((limited.content[0] as { text: string }).text).toMatch(/HTTP 429.*wait briefly[\s\S]*Rate limit reached/);
  });

  it('fetches a page as Markdown and explains a missing page', async () => {
    addDeepseek();
    const net = vi.fn(async (_url: string, _init: RequestInit) => json({ title: 'Example', content: '# Example\n\nBody' }));
    vi.stubGlobal('fetch', net);
    const r = await runDeepseekTool('web__deepseek_fetch', { url: 'https://example.com/a' }, signal());
    expect(net.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(JSON.parse(String(net.mock.calls[0]![1].body))).toEqual({ url: 'https://example.com/a' });
    expect(r).toEqual({ content: [{ type: 'text', text: 'Title: Example\nURL: https://example.com/a\n\n# Example\n\nBody' }], isError: false });
    net.mockResolvedValueOnce(json({ error: { message: 'no content', type: 'invalid_request_error', param: null, code: 'not_found' } }, 404));
    expect((await runDeepseekTool('web__deepseek_fetch', { url: 'https://example.com/b' }, signal())).content[0]).toMatchObject({ text: expect.stringContaining('no usable page content') });
    expect((await runDeepseekTool('web__deepseek_fetch', { url: 'file:///etc/passwd' }, signal())).isError).toBe(true);
    expect(net).toHaveBeenCalledTimes(2);
  });

  it('needs a DeepSeek key at call time', async () => {
    const net = vi.fn();
    vi.stubGlobal('fetch', net);
    const r = await runDeepseekTool('web__deepseek_search', { query: 'x' }, signal());
    expect(r.isError).toBe(true);
    expect(net).not.toHaveBeenCalled();
  });
});

describe('agent loop', () => {
  const start = () => {
    const chat = providersRepo.create({ name: 'chat', type: 'openai', baseUrl: 'http://x', apiKey: 'k' });
    const m = modelsRepo.upsert(chat.id, { modelId: 'test' });
    const conv = conversationsRepo.create({ providerId: chat.id, modelId: m.id });
    messagesRepo.create({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'search' }] });
    return conv;
  };

  it('flags a rate-limited Exa result and lets the model continue with DeepSeek search', async () => {
    addExa();
    addDeepseek();
    vi.stubGlobal('fetch', vi.fn(async () => json({ results: [deepseekResult] })));
    const conv = start();
    await runAgent({ conversation: conv, signal: signal(), emit: () => {} });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.tools.map(t => t.name)).toEqual(expect.arrayContaining(['mcp__exa__web_search_exa', 'web__deepseek_search', 'web__deepseek_fetch']));
    const msgs = messagesRepo.list(conv.id);
    const exa = msgs[2]!.content[0]!;
    const ds = msgs[4]!.content[0]!;
    if (exa.type !== 'tool_result' || ds.type !== 'tool_result') throw new Error('expected tool results');
    expect(exa.is_error).toBe(true);
    expect(exa.content).toEqual([{ type: 'text', text: EXA_LIMIT }, { type: 'text', text: expect.stringContaining('Continue with web__deepseek_search') }]);
    expect(ds.is_error).toBe(false);
    expect(JSON.stringify(ds.content)).toContain('https://example.com/news');
  });

  it('leaves Exa results untouched without a fallback, or when Exa succeeds', async () => {
    addExa();
    const conv = start();
    await runAgent({ conversation: conv, signal: signal(), emit: () => {} });
    expect(calls[0]!.tools.some(t => t.name.startsWith('web__'))).toBe(false);
    expect(messagesRepo.list(conv.id)[2]!.content[0]).toMatchObject({ is_error: false, content: [{ type: 'text', text: EXA_LIMIT }] });

    calls.length = 0;
    addDeepseek();
    exaReply = 'Title: A\nURL: https://a.example\nHighlights:\nrate limit discussion';
    vi.stubGlobal('fetch', vi.fn(async () => json({ results: [deepseekResult] })));
    const second = start();
    await runAgent({ conversation: second, signal: signal(), emit: () => {} });
    expect(messagesRepo.list(second.id)[2]!.content[0]).toMatchObject({ is_error: false, content: [{ type: 'text', text: exaReply }] });
  });
});
