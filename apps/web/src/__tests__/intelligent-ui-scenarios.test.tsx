import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@aichat/shared';
import { ArtifactMessage } from '../components/artifacts/ArtifactMessage.js';
import { useChat } from '../store/chat.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fence = (code: string, close = true) =>
  `\`\`\`aichat-ui\n${code}${close ? '\n```' : ''}`;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const msg: Message = { id: 'm', conversationId: 'c', role: 'assistant', seq: 1, createdAt: '', content: [{ type: 'text', text: '' }] };
  useChat.setState({
    current: { id: 'c', title: '', createdAt: '', updatedAt: '', providerId: null, modelId: null, systemPrompt: '', settings: {}, groupId: null },
    messages: [msg],
    streaming: null,
    running: false,
    send: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (text: string, live = false) => {
  await act(async () => {
    root.render(<ArtifactMessage text={text} messageId="m" block={0} live={live} />);
  });
};

const change = async (label: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('Intelligent UI Editorial Minimalism Acceptance Scenarios', () => {
  it('Scenario 1: renders single metric naturally without artificial container or header chrome', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '月度收益' }),
      JSON.stringify({ type: 'metric', id: 'm1', label: '月收益率', expr: '12.5', digits: 1, unit: '%' }),
    ].join('\n');
    await mount(fence(code));

    // Metric rendered inline cleanly
    expect(host.querySelector('.iui-title')?.textContent).toBe('月度收益');
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('12.5%');
    expect(host.querySelector('.iui-metric > span')?.textContent).toBe('月收益率');
  });

  it('Scenario 2: 4 sliders + dynamically calculated metric', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '四维评分' }),
      JSON.stringify({ type: 'slider', id: 's1', label: '维度一', value: 10, min: 0, max: 25, step: 1 }),
      JSON.stringify({ type: 'slider', id: 's2', label: '维度二', value: 20, min: 0, max: 25, step: 1 }),
      JSON.stringify({ type: 'slider', id: 's3', label: '维度三', value: 15, min: 0, max: 25, step: 1 }),
      JSON.stringify({ type: 'slider', id: 's4', label: '维度四', value: 25, min: 0, max: 25, step: 1 }),
      JSON.stringify({ type: 'metric', id: 'total', label: '总分', expr: 's1 + s2 + s3 + s4', digits: 0, unit: '分' }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('70分');

    await change('维度一', '25');
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('85分');
  });

  it('Scenario 3: 3 parameter controls (odd count) render without odd stretching', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '三项调节' }),
      JSON.stringify({ type: 'slider', id: 'p1', label: '参数1', value: 10, min: 0, max: 100, step: 1 }),
      JSON.stringify({ type: 'number', id: 'p2', label: '参数2', value: 20, min: 0, max: 100, step: 1 }),
      JSON.stringify({ type: 'select', id: 'p3', label: '参数3', value: 1, options: [{ label: '高', value: 1 }, { label: '低', value: 2 }] }),
    ].join('\n');

    await mount(fence(code));
    const controlGroup = host.querySelector('.iui-control-group');
    expect(controlGroup).not.toBeNull();
    expect(controlGroup?.children).toHaveLength(3);
  });

  it('Scenario 4: Choice (segmented control) + Check + Select mixed UI', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '配置选项' }),
      JSON.stringify({ type: 'choice', id: 'tier', label: '档次', value: 1, options: [{ label: '基础', value: 1 }, { label: '进阶', value: 2 }] }),
      JSON.stringify({ type: 'check', id: 'addon', label: '附加服务', value: true, text: '包含技术支持' }),
      JSON.stringify({ type: 'select', id: 'region', label: '区域', value: 10, options: [{ label: '华东', value: 10 }, { label: '华北', value: 20 }] }),
      JSON.stringify({ type: 'metric', id: 'cost', label: '费用', expr: 'tier * 100 + (addon ? 50 : 0)', digits: 0, unit: '元' }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('150元');

    // Click '进阶' in Segmented Control
    const advancedBtn = [...host.querySelectorAll<HTMLButtonElement>('.iui-choice button')].find(b => b.textContent?.trim() === '进阶')!;
    await act(async () => advancedBtn.click());
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('250元');

    // Toggle addon checkbox
    const checkInput = host.querySelector<HTMLInputElement>('.iui-check input')!;
    await act(async () => {
      checkInput.click();
    });
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('200元');
  });

  it('Scenario 5: Chart + slider parameter linkage', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '图表联动' }),
      JSON.stringify({ type: 'slider', id: 'slope', label: '斜率', value: 2, min: 1, max: 10, step: 1 }),
      JSON.stringify({ type: 'chart', id: 'c1', label: '线性函数', min: 0, max: 10, series: [{ label: 'y = kx', expr: 'slope * x' }] }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelector('.iui-chart')).not.toBeNull();
    expect(host.querySelector('.iui-chart-data table')?.textContent).toContain('20');

    await change('斜率', '5');
    expect(host.querySelector('.iui-chart-data table')?.textContent).toContain('50');
  });

  it('Scenario 6: Table + Cards mixed content', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '混合内容' }),
      JSON.stringify({ type: 'table', id: 'tbl', columns: ['方案', '成本'], rows: [['方案A', '100'], ['方案B', '200']] }),
      JSON.stringify({ type: 'cards', id: 'crd', items: [{ title: '总结A', text: '适合小团队' }, { title: '总结B', text: '适合大企业' }] }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelectorAll('table tr')).toHaveLength(3); // header + 2 rows
    expect(host.querySelectorAll('.iui-cards article')).toHaveLength(2);
  });

  it('Scenario 7: Long titles, long text, units, and large numbers', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '超长中文业务场景标题分析报告演示说明' }),
      JSON.stringify({ type: 'text', id: 'tx', text: '这是一段很长的说明文字，包含中文逗号、句号以及各种复杂的上下文排版，确保自动折行和间距正常。' }),
      JSON.stringify({ type: 'metric', id: 'm_big', label: '累计处理数据总量', expr: '987654321', digits: 0, unit: '条记录' }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelector('.iui-title')?.textContent).toBe('超长中文业务场景标题分析报告演示说明');
    expect(host.querySelector('.iui-text')?.textContent).toContain('这是一段很长的说明文字');
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('987,654,321条记录');
  });

  it('Scenario 8: Conditional visibility and reset state', async () => {
    const code = [
      JSON.stringify({ type: 'view', title: '条件联动' }),
      JSON.stringify({ type: 'choice', id: 'show_extra', label: '显示更多', value: 0, options: [{ label: '隐藏', value: 0 }, { label: '显示', value: 1 }] }),
      JSON.stringify({ type: 'metric', id: 'extra', label: '额外指标', expr: '99', digits: 0, when: 'show_extra == 1' }),
    ].join('\n');

    await mount(fence(code));
    expect(host.querySelector('.iui-metric')).toBeNull();

    // Click '显示'
    const showBtn = [...host.querySelectorAll<HTMLButtonElement>('.iui-choice button')].find(b => b.textContent?.trim() === '显示')!;
    await act(async () => showBtn.click());
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('99');

    // Reset button
    const resetBtn = host.querySelector<HTMLButtonElement>('.iui-reset')!;
    await act(async () => resetBtn.click());
    // Should reset to default show_extra == 0
    expect(host.querySelector('.iui-metric')).toBeNull();
  });

  it('Scenario 9: Streaming NDJSON row by row and interrupted generation', async () => {
    const row1 = JSON.stringify({ type: 'view', title: '流式构建' });
    const row2 = JSON.stringify({ type: 'metric', id: 'm1', label: '阶段一', expr: '1', digits: 0 });

    // Step 1: partial live stream
    await mount(fence(`${row1}\n${row2}`, false), true);
    expect(host.textContent).toContain('正在构建…');
    expect(host.querySelector('.iui-metric output')?.textContent).toBe('1');

    // Step 2: generation interrupted
    await mount(fence(`${row1}\n${row2}`, false), false);
    expect(host.textContent).toContain('生成已中断');
  });
});
