import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Block, ToolDef } from '@aichat/shared';
import { closeDb, getDb, initDb } from '../src/db/database.js';
import { conversationsRepo } from '../src/db/repos/conversations.js';
import { toolResultsRepo } from '../src/db/repos/toolResults.js';
import { allocateToolResultBudgets, prepareToolResult as prepare, readToolResult, resultTextChars, readResultTool } from '../src/agent/toolResults.js';
import { stableToolDefs } from '../src/llm/tools.js';
import { toOpenAIMessages, toOpenAITools } from '../src/llm/openai/convert.js';
import { toAnthropicMessages, toAnthropicTools } from '../src/llm/anthropic/convert.js';
import type { LLMMessage } from '../src/llm/types.js';

let dir: string;
let conv: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-results-'));
  initDb(path.join(dir, 'test.db'));
  conv = conversationsRepo.create({}).id;
});
afterEach(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const prepareToolResult = (...args: Parameters<typeof prepare>) => prepare(...args).content;
const text = (s: string): Block[] => [{ type: 'text', text: s }];
const plain = (blocks: Block[]) => blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
const idOf = (blocks: Block[]) => /result_id: (result_[\w-]+)/.exec(plain(blocks))![1]!;
const page = (args: unknown, max = 8000) => {
  const r = readToolResult(conv, args, max);
  expect(r.isError).toBe(false);
  return JSON.parse(plain(r.content));
};

describe('tool result storage and previews', () => {
  it('saves medium results for later compaction without changing their wire content', () => {
    const content = text('evidence '.repeat(400));
    const result = prepare(conv, 'demo', content);
    expect(result.content).toBe(content);
    expect(result.resultId).toBeDefined();
    expect(toolResultsRepo.get(conv, result.resultId!)?.text).toBe(plain(content));
  });
  it('leaves small results untouched, including images and errors', () => {
    const content: Block[] = [...text('ERROR: forbidden'), { type: 'image', mime: 'image/png', data: 'AAAA' }];
    expect(prepareToolResult(conv, 'demo', content)).toBe(content);
    expect(toolResultsRepo.has(conv)).toBe(false);
  });

  it('saves every character beyond the former 50k cutoff and preserves media', () => {
    const original = '甲'.repeat(60_000) + '\nTAIL EVIDENCE';
    const image: Block = { type: 'image', mime: 'image/png', data: 'AAAA' };
    const content = [...text(original), image];
    const prepared = prepareToolResult(conv, 'demo', content);
    expect(plain(prepared).length).toBeLessThanOrEqual(8000);
    expect(prepared).toContain(image);
    expect(content[0]).toEqual({ type: 'text', text: original });
    const id = idOf(prepared);
    expect(toolResultsRepo.get(conv, id)?.text).toBe(original);
    expect(page({ result_id: id, query: 'TAIL EVIDENCE' }).matches[0].text).toContain('TAIL EVIDENCE');
    expect(plain(prepared)).toContain('not the complete result');
  });

  it('exposes multiple search sources and their URLs instead of only the first body', () => {
    const original = Array.from({ length: 10 }, (_, i) => `Title: Document ${i}\nURL: https://example.com/${i}\nPublished: 2026-09-06\nHighlights:\n${`Evidence ${i}. `.repeat(700)}`).join('\n\n');
    const prepared = prepareToolResult(conv, 'mcp__exa__web_search_exa', text(original));
    const preview = plain(prepared);
    expect(preview.length).toBeLessThanOrEqual(8000);
    for (let i = 0; i < 8; i++) expect(preview).toContain(`https://example.com/${i}`);
    expect(preview).toContain('Showing 8 of 10 sources');
    const raw = toolResultsRepo.get(conv, idOf(prepared))!.text;
    expect(raw).toBe(original);
    const offset = Number(/\[Source 4; offset (\d+)\]/.exec(preview)![1]);
    expect(page({ result_id: idOf(prepared), offset }).text).toMatch(/^Title: Document 3/);
  });

  it('projects structured search results and retains unknown JSON exactly in storage', () => {
    const raw = JSON.stringify({ results: Array.from({ length: 5 }, (_, i) => ({ title: `Title ${i}`, url: `https://example.com/${i}`, highlights: ['useful evidence'], text: 'long body'.repeat(3000), custom: 'retain this' })) });
    const preview = prepareToolResult(conv, 'search', text(raw));
    expect(plain(preview)).toContain('useful evidence');
    expect(plain(preview)).toContain('https://example.com/4');
    expect(toolResultsRepo.get(conv, idOf(preview))!.text).toBe(raw);
  });

  it('counts separators without turning tiny multi-block results into oversized previews', () => {
    const content = [...text('one'), ...text('two')];
    expect(resultTextChars(content)).toBe(8);
    expect(prepareToolResult(conv, 'demo', content, resultTextChars(content))).toBe(content);
  });

  it('allocates a fair batch budget with short results intact', () => {
    expect(allocateToolResultBudgets([100, 50000, 50000, 50000])).toEqual([100, 5300, 5300, 5300]);
    const sizes = [100, 50000, 50000, 50000];
    const result = sizes.map((n, i) => prepareToolResult(conv, 'demo', text('x'.repeat(n)), allocateToolResultBudgets(sizes)[i]));
    expect(result.reduce((n, c) => n + resultTextChars(c), 0)).toBeLessThanOrEqual(16000);
    expect(allocateToolResultBudgets(Array(30).fill(100000))).toEqual(Array(30).fill(1200));
  });

  it('survives DB reopen and cascades deletion with the conversation', () => {
    const id = idOf(prepareToolResult(conv, 'demo', text('saved'.repeat(5000))));
    closeDb();
    initDb(path.join(dir, 'test.db'));
    expect(page({ result_id: id }).text).toMatch(/^saved/);
    getDb().prepare('DELETE FROM conversations WHERE id=?').run(conv);
    expect(getDb().prepare('SELECT count(*) AS n FROM tool_result_resources').get()).toMatchObject({ n: 0 });
  });
});

describe('reading original tool results', () => {
  it('pages through original text without loss, including surrogate pairs', () => {
    const original = '开头😀\n'.repeat(3000);
    const id = idOf(prepareToolResult(conv, 'demo', text(original)));
    let offset = 0;
    let restored = '';
    for (let i = 0; i < 100; i++) {
      const p = page({ result_id: id, offset, limit: 1001 });
      expect(p.start).toBe(offset);
      restored += p.text;
      if (p.next_offset === null) break;
      expect(p.next_offset).toBeGreaterThan(offset);
      offset = p.next_offset;
    }
    expect(restored).toBe(original);
    expect(page({ result_id: id, offset: original.length }).text).toBe('');
  });

  it('searches literally and paginates matches with stable original offsets', () => {
    const original = Array.from({ length: 12 }, (_, i) => `第${i}条 A.*B ` + 'x'.repeat(1500)).join('\n');
    const id = idOf(prepareToolResult(conv, 'demo', text(original)));
    let offset = 0;
    const hits: number[] = [];
    for (let i = 0; i < 20; i++) {
      const p = page({ result_id: id, query: 'a.*b', offset });
      for (const match of p.matches) {
        expect(match.text).toContain('A.*B');
        expect(original.slice(match.match_offset, match.match_offset + 4)).toBe('A.*B');
        hits.push(match.match_offset);
      }
      if (p.next_offset === null) break;
      expect(p.next_offset).toBeGreaterThan(offset);
      offset = p.next_offset;
    }
    expect(hits).toHaveLength(12);
    expect(new Set(hits).size).toBe(12);
    expect(page({ result_id: id, query: 'missing' })).toMatchObject({ matches: [], next_offset: null });
  });

  it('bounds wire output even for JSON-escaped control characters and many matches', () => {
    const id = idOf(prepareToolResult(conv, 'demo', text('\u0001\n\t"MATCH"'.repeat(4000))));
    for (const query of [undefined, 'MATCH']) {
      const r = readToolResult(conv, { result_id: id, query, limit: 8000 }, 1200);
      expect(plain(r.content).length).toBeLessThanOrEqual(1200);
      expect(JSON.parse(plain(r.content)).next_offset).toBeGreaterThan(0);
    }
  });

  it('rejects cross-conversation access and invalid offsets/limits', () => {
    const id = idOf(prepareToolResult(conv, 'demo', text('secret'.repeat(2000))));
    const other = conversationsRepo.create({}).id;
    expect(readToolResult(other, { result_id: id }).isError).toBe(true);
    for (const args of [{ offset: -1 }, { offset: 9999999 }, { offset: 0.5 }, { limit: 0 }, { limit: 8001 }, { query: '' }, { query: 'a'.repeat(201) }]) {
      expect(readToolResult(conv, { result_id: id, ...args }).isError).toBe(true);
    }
  });
});

describe.each(['openai', 'anthropic'] as const)('%s tool context', protocol => {
  const convert = protocol === 'openai' ? toOpenAIMessages.bind(null, undefined) : toAnthropicMessages;
  const tools = protocol === 'openai' ? toOpenAITools : toAnthropicTools;
  it('preserves call/result pairs, saved result references and earlier message prefixes', () => {
    const result = prepareToolResult(conv, 'demo', text('evidence'.repeat(10000)));
    const id = idOf(result);
    const history: LLMMessage[] = [
      { role: 'user', content: text('research') },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'demo', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: result, is_error: true }] },
    ];
    const before = convert(history);
    const after = convert([...history,
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2', name: readResultTool.name, input: { result_id: id, query: 'evidence' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: readToolResult(conv, { result_id: id, query: 'evidence' }).content }] },
    ]);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(JSON.stringify(before)).toContain(id);
    expect(JSON.stringify(after)).toContain('call_1');
    expect(JSON.stringify(after)).toContain('call_2');
    if (protocol === 'openai') expect(JSON.stringify(before)).toContain('ERROR:');
    else expect(JSON.stringify(before)).toContain('"is_error":true');
    expect(JSON.stringify(tools([readResultTool]))).toContain('result_id');
  });
  it('keeps tool definition order stable across reconnects without mutating schemas', () => {
    const a: ToolDef = { name: 'a', description: 'A', inputSchema: { required: ['z', 'a'], properties: { z: { type: 'string' }, a: { type: 'integer' } }, type: 'object' } };
    const b: ToolDef = { name: 'b', description: 'B', inputSchema: { type: 'object' } };
    const snapshot = JSON.stringify(a);
    const reordered = { ...a, inputSchema: { type: 'object', properties: { a: { type: 'integer' }, z: { type: 'string' } }, required: ['z', 'a'] } };
    expect(JSON.stringify(tools(stableToolDefs([a, b])))).toBe(JSON.stringify(tools(stableToolDefs([b, reordered]))));
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('tool result media conversion', () => {
  it('sends OpenAI tool images after all parallel tool results with their call IDs', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: text('inspect') },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'a', name: 'one', input: {} },
        { type: 'tool_use', id: 'b', name: 'two', input: {} },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'image', mime: 'image/png', data: 'AAAA' }] },
        { type: 'tool_result', tool_use_id: 'b', content: text('result B') },
      ] },
    ];
    const messages = toOpenAIMessages(undefined, history);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    expect(messages[4]).toEqual({ role: 'user', content: [
      { type: 'text', text: 'Images from tool result a:' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ] });
  });

  it('keeps Anthropic tool documents alongside images and text', () => {
    const messages = toAnthropicMessages([{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: [
        { type: 'document', mime: 'application/pdf', name: 'source.pdf', data: 'AAAA' },
        { type: 'image', mime: 'image/png', data: 'BBBB' },
        { type: 'text', text: 'source context' },
      ] },
    ] }]);
    expect(messages[0]!.content).toEqual([{
      type: 'tool_result', tool_use_id: 'a', is_error: false, content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' }, title: 'source.pdf' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
        { type: 'text', text: 'source context' },
      ],
    }]);
  });
});
