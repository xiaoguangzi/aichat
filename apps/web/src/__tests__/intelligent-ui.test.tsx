import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileUi, evaluateUi, parseArtifacts, parseUiFences, uiTemplate, type Message } from '@aichat/shared';
import { ArtifactMessage } from '../components/artifacts/ArtifactMessage.js';
import { useChat } from '../store/chat.js';

const rows = [
  { type: 'view', title: '聚餐分账', description: '调整参数，实时分账。' },
  { type: 'number', id: 'total', label: '账单', value: 240, min: 0, max: 10000, step: 1 },
  { type: 'slider', id: 'people', label: '人数', value: 4, min: 1, max: 20, step: 1 },
  { type: 'choice', id: 'mode', label: '模式', value: 1, options: [{ label: '均分', value: 1 }, { label: '说明', value: 2 }] },
  { type: 'metric', id: 'each', label: '人均', expr: 'total / people', digits: 2, unit: '元', when: 'mode == 1' },
  { type: 'text', id: 'help', text: '按 {{people}} 人均分。', when: 'mode == 2' },
  { type: 'check', id: 'paid', label: '已结清', value: false },
  { type: 'chart', id: 'curve', label: '人数与金额', min: 1, max: 20, series: [{ label: '人均', expr: 'total / x' }] },
  { type: 'diagram', id: 'map', label: '分账关系', nodes: [{ id: 'bill', label: '账单', text: '账单总额 {{total}} 元' }, { id: 'group', label: '成员', text: '共 {{people}} 人' }], edges: [{ from: 'bill', to: 'group', label: '均分' }] },
  { type: 'action', id: 'ask', label: '继续调整', prompt: '帮我按 {{people}} 人调整分账。' },
];
const code = rows.map(r => JSON.stringify(r)).join('\n');
const fence = (body = code, close = true) => `前文\n\n\`\`\`aichat-ui\n${body}${close ? '\n```\n\n后文' : ''}`;
const message = (id = 'm'): Message => ({ id, conversationId: 'c', role: 'assistant', seq: 1, createdAt: '', content: [{ type: 'text', text: fence() }] });

describe('streaming UI compiler and interpreter', () => {
  it('preserves fences and nested examples, including CRLF and interrupted streams', () => {
    expect(parseUiFences(fence())).toMatchObject([{ complete: true, code }]);
    expect(parseUiFences(fence(code, false))).toMatchObject([{ complete: false }]);
    expect(parseUiFences(fence().replaceAll('\n', '\r\n'))).toHaveLength(1);
    expect(parseUiFences(`~~~~text\n${fence()}\n~~~~`)).toEqual([]);
    expect(parseArtifacts(fence())).toEqual([]);
  });
  it('shows completed components before the stream finishes, defers partial JSON, and reports malformed rows', () => {
    const partial = `${rows.slice(0, 3).map(r => JSON.stringify(r)).join('\n')}\n{"type":"metric","id":"unfinished`;
    expect(compileUi(partial, false).nodes).toHaveLength(2);
    expect(compileUi(partial, false).errors).toEqual([]);
    expect(compileUi(partial, true).errors).toHaveLength(1);
    expect(compileUi(`${JSON.stringify(rows[0])}\ninvalid\n${JSON.stringify(rows[1])}`, true).nodes).toHaveLength(1);
  });
  it('rejects duplicate IDs, invalid ranges, unsupported code, bad graph edges and oversized content', () => {
    const errors = compileUi([rows[0], rows[1], rows[1], { ...rows[2], min: 20, max: 1 }, { type: 'script', id: 'evil', text: 'alert(1)' }, { ...rows[8], edges: [{ from: 'bill', to: 'missing' }] }].map(r => JSON.stringify(r)).join('\n'), true).errors;
    expect(errors).toHaveLength(4);
    expect(compileUi('x'.repeat(150001), true).errors).toHaveLength(1);
    expect(compileUi('{}', true).view).toBeUndefined();
  });
  it('evaluates arithmetic and conditions without accepting executable JavaScript or nonfinite values', () => {
    const state = { people: 4, total: 240 };
    expect(evaluateUi('total / people * (1 + 10 / 100)', state)).toBe(66);
    expect(evaluateUi('people > 2 && people <= 8 ? max(3, pow(people, 2)) : 0', state)).toBe(16);
    expect(evaluateUi('2 ^ 3 ^ 2', state)).toBe(512);
    expect(evaluateUi('sin(pi / 2)', state)).toBe(1);
    for (const expr of ['window.alert(1)', 'total.constructor', 'fetch(1)', '1;2', '1 / 0', 'missing + 1', '('.repeat(40) + '1' + ')'.repeat(40), 'constructor(1)']) expect(evaluateUi(expr, state), expr).toBeUndefined();
    expect(uiTemplate('{{total/people}} 元 / {{unknown}}', state)).toBe('60 元 / —');
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  sessionStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useChat.setState({ current: { id: 'c', title: '', createdAt: '', updatedAt: '', providerId: null, modelId: null, systemPrompt: '', settings: {}, groupId: null }, messages: [message()], streaming: null, running: false, send: vi.fn().mockResolvedValue(undefined) });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const mount = async (text = fence(), live = false, messageId = 'm') => { await act(async () => root.render(<ArtifactMessage text={text} messageId={messageId} block={0} live={live} />)); };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)!;
const change = async (label: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
};

it('renders inline, updates metrics and charts locally, switches views and submits current selections', async () => {
  await mount();
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.textContent).toContain('前文'); expect(host.textContent).toContain('后文');
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('60.00元');
  const path = host.querySelector('svg path')?.getAttribute('d');
  await change('人数', '8');
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('30.00元');
  await change('账单', '480');
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('60.00元');
  // The chart's data changes even when its auto-scaled path has the same shape.
  expect(host.querySelector('.iui-chart-data table')?.textContent).toContain('480');
  expect(path).toBeTruthy();
  await act(async () => button('说明').click());
  expect(host.querySelector('.iui-metric')).toBeNull();
  expect(host.querySelector('.iui-text')?.textContent).toBe('按 8 人均分。');
  await act(async () => button('账单').click());
  expect(host.querySelector('.iui-diagram-detail')?.textContent).toContain('480 元');
  await act(async () => button('继续调整').click());
  expect(useChat.getState().send).toHaveBeenCalledOnce();
  expect(useChat.getState().send).toHaveBeenCalledWith(expect.stringContaining('按 8 人'));
  expect(useChat.getState().send).toHaveBeenCalledWith(expect.stringContaining('模式：说明'));
  expect(useChat.getState().send).toHaveBeenCalledWith(expect.stringContaining('已结清：未勾选'));
});

it('restores browser state after remount, isolates messages and resets to model defaults', async () => {
  await mount(); await change('人数', '8');
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(); expect(host.querySelector('.iui-metric output')?.textContent).toBe('30.00元');
  await act(async () => button('重置交互').click());
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('60.00元');
  await change('人数', '8');
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(fence(), false, 'other');
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('60.00元');
  expect(button('继续调整').disabled).toBe(true);
});

it('retains selections as new rows stream in, disables follow-ups while incomplete/running and on a different conversation', async () => {
  await mount(fence(rows.slice(0, 3).map(r => JSON.stringify(r)).join('\n'), false), true);
  await change('人数', '8'); await mount(fence(code, false), true);
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('30.00元');
  expect(button('继续调整').disabled).toBe(true);
  await mount();
  await act(async () => useChat.setState({ running: true })); expect(button('继续调整').disabled).toBe(true);
  await act(async () => useChat.setState({ running: false, current: { ...useChat.getState().current!, id: 'another' } })); expect(button('继续调整').disabled).toBe(true);
});

it('retains artifact indices when UI and artifacts interleave, and escapes untrusted text', async () => {
  const text = `${fence()}\n\n\`\`\`html artifact id="page" title="Page"\n<h1>Hi</h1>\n\`\`\`\n\n${fence(code.replace('调整参数，实时分账。', '<script>alert(1)</script>'))}`;
  await mount(text);
  expect(host.querySelectorAll('[data-intelligent-ui]')).toHaveLength(2);
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.includes('Page'))).toBe(true);
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('<script>alert(1)</script>');
});

it('survives corrupt saved state, shows invalid component errors, and exposes interrupted source', async () => {
  sessionStorage.setItem('aichat:ui:m:0:0', 'null');
  await mount(fence(`${code}\n{"type":"script","id":"bad"}`));
  expect(host.querySelector('.iui-metric output')?.textContent).toBe('60.00元');
  expect(host.textContent).toContain('部分界面无法显示');
  expect(host.querySelector('.iui-source pre')?.textContent).toContain('"type":"script"');
  await mount(fence(`${JSON.stringify(rows[0])}\n{`, false));
  expect(host.textContent).toContain('生成已中断');
});

it('renders recovered historical text and numeric checkboxes, preserving source and restoring checkbox state', async () => {
  const historicalCode = [
    { type: 'view', title: '校正清单' },
    { type: 'text', text: '校正清单：估算是起点，务必用实测与体况回验。' },
    { type: 'check', id: 'ref', label: '显示对比说明', value: 1 },
    { type: 'check', id: 'risk', label: '显示边界与风险', value: 0 },
    { type: 'text', id: 'details', text: '边界与风险已显示', when: 'risk == 1' },
  ].map(node => JSON.stringify(node)).join('\n');
  await mount(fence(historicalCode));
  expect(host.textContent).toContain('校正清单：估算是起点，务必用实测与体况回验。');
  expect(host.querySelector('.iui-error')).toBeNull();
  expect(host.querySelector('.iui-source pre')?.textContent).toBe(historicalCode);
  const checks = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checks[0]?.checked).toBe(true);
  expect(checks[1]?.checked).toBe(false);
  expect([...host.querySelectorAll('.iui-text')].some(node => node.textContent === '边界与风险已显示')).toBe(false);
  await act(async () => checks[1]!.click());
  expect([...host.querySelectorAll('.iui-text')].some(node => node.textContent === '边界与风险已显示')).toBe(true);
  await act(async () => root.unmount()); root = createRoot(host);
  await mount(fence(historicalCode));
  expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.checked).toBe(true);
  expect([...host.querySelectorAll('.iui-text')].some(node => node.textContent === '边界与风险已显示')).toBe(true);
});

it('rechecks conversation ownership at click time and deduplicates pending follow-ups', async () => {
  let resolve: () => void = () => {};
  const send = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  useChat.setState({ send }); await mount();
  const click = button('继续调整');
  await act(async () => { click.click(); click.click(); });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => resolve());
  await act(async () => {
    useChat.setState({ current: { ...useChat.getState().current!, id: 'switched' } });
    // The old DOM remains mounted until React commits the store notification.
    click.click();
  });
  expect(send).toHaveBeenCalledOnce();
});
