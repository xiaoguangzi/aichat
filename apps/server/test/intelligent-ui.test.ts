import { expect, it, vi } from 'vitest';
import type { Conversation } from '@aichat/shared';
import { compileUi } from '@aichat/shared';
vi.mock('../src/skills/registry.js', () => ({ skillRegistry: { indexText: () => '' } }));
const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

it('offers the same inline UI contract without tools and preserves project/user instructions and artifact support', () => {
  const conv = { systemPrompt: 'Answer in Chinese.', settings: {} } as Conversation;
  for (const hasTools of [false, true]) {
    const prompt = buildSystemPrompt(conv, { hasTools, projectInstructions: 'Use evidence.' });
    expect(prompt).toContain('Use evidence.'); expect(prompt).toContain('Answer in Chinese.');
    expect(prompt).toContain('aichat-ui'); expect(prompt).toContain('one complete JSON object per line');
    expect(prompt).toContain('Every following component, including text, must include a unique id');
    expect(prompt).toContain('In check component JSON, value must be a boolean true/false');
    expect(prompt).toContain('Only when referenced in expressions is a checkbox represented as numeric 0/1');
    expect(prompt).toContain('Simple answers stay ordinary Markdown'); expect(prompt).toContain('```html artifact');
    const sample = prompt.slice(prompt.indexOf('{"type":"view","title":"Dinner bill splitter"'), prompt.indexOf('\n\nCurrent date:'));
    const compiled = compileUi(sample, true);
    expect(compiled.errors).toEqual([]); expect(compiled.nodes).toHaveLength(5);
  }
});

const uiCode = (...nodes: unknown[]) => [{ type: 'view', title: '生成格式回归' }, ...nodes].map(node => JSON.stringify(node)).join('\n');

it('recovers missing presentation IDs with stable identities independent of later explicit IDs', () => {
  const text = { type: 'text', text: '校正清单：估算是起点，务必用实测与体况回验。' };
  const partial = compileUi(uiCode(text), false);
  const full = compileUi(uiCode(text, { ...text, id: 'ui_line_2' }, text), true);
  expect(partial.errors).toEqual([]);
  expect(full.errors).toEqual([]);
  expect(full.nodes[0]).toEqual(partial.nodes[0]);
  expect(new Set(full.nodes.map(node => node.id)).size).toBe(3);
  expect(full.nodes[1]?.id).toBe('ui_line_2');
});

it('normalizes numeric checkbox states without accepting strings or arbitrary truthy values', () => {
  const check = { type: 'check', id: 'risk', label: '显示边界与风险' };
  for (const value of [0, 1, false, true, undefined]) {
    const compiled = compileUi(uiCode({ ...check, value }), true);
    expect(compiled.errors).toEqual([]);
    expect(compiled.nodes[0]).toMatchObject({ value: value === true || value === 1 });
  }
  for (const value of ['0', 'false', 2, null, {}]) {
    const compiled = compileUi(uiCode({ ...check, value }), true);
    expect(compiled.nodes).toEqual([]);
    expect(compiled.errors).toEqual(['第 2 行：value 必须是 true/false 或 0/1。']);
  }
});

it('keeps invalid and missing control IDs, unsupported types and invalid fields visible as specific errors', () => {
  const compiled = compileUi(uiCode(
    { type: 'slider', label: '人数', value: 4, min: 1, max: 20 },
    { type: 'text', id: null, text: '无效 ID' },
    { type: 'script', id: 'bad', text: 'alert(1)' },
    { type: 'metric', id: 'each', label: '人均' },
    { type: 'text', text: '其余内容仍显示' },
  ), true);
  expect(compiled.errors).toEqual([
    '第 2 行：id 缺失或类型无效，需要文本。',
    '第 3 行：id 缺失或类型无效，需要文本。',
    '第 4 行：type 不受支持。',
    '第 5 行：expr 缺失或类型无效，需要文本。',
  ]);
  expect(compiled.nodes).toHaveLength(1);
});
