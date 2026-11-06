import { describe, expect, it } from 'vitest';
import type { UiNode } from '@aichat/shared';
import { composeVisualBlocks } from '../components/intelligent-ui/composition.js';

describe('Intelligent UI Composition Engine', () => {
  it('groups contiguous metrics together', () => {
    const nodes: UiNode[] = [
      { type: 'metric', id: 'm1', label: '收入', expr: '100', digits: 2 },
      { type: 'metric', id: 'm2', label: '支出', expr: '50', digits: 2 },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'm1',
      kind: 'metrics',
      nodes: [{ id: 'm1' }, { id: 'm2' }],
    });
  });

  it('groups contiguous parameter controls together into parameters grid', () => {
    const nodes: UiNode[] = [
      { type: 'slider', id: 's1', label: '折扣', value: 10, min: 0, max: 100, step: 1 },
      { type: 'number', id: 'n1', label: '基数', value: 100, min: 0, max: 1000, step: 1 },
      { type: 'select', id: 'sel1', label: '等级', value: 1, options: [{ label: 'A', value: 1 }] },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 's1',
      kind: 'parameters',
      nodes: [{ id: 's1' }, { id: 'n1' }, { id: 'sel1' }],
    });
  });

  it('does NOT merge same-type nodes across intervening semantic nodes', () => {
    const nodes: UiNode[] = [
      { type: 'metric', id: 'm1', label: '收入', expr: '100', digits: 2 },
      { type: 'text', id: 't1', text: '说明文字' },
      { type: 'metric', id: 'm2', label: '支出', expr: '50', digits: 2 },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.kind).toBe('metrics');
    expect(blocks[0]!.nodes).toHaveLength(1);
    expect(blocks[1]!.kind).toBe('standalone');
    expect(blocks[1]!.nodes[0]!.id).toBe('t1');
    expect(blocks[2]!.kind).toBe('metrics');
    expect(blocks[2]!.nodes).toHaveLength(1);
  });

  it('strictly preserves the sequence order from NDJSON', () => {
    const nodes: UiNode[] = [
      { type: 'text', id: 't1', text: '前导' },
      { type: 'slider', id: 's1', label: '参数1', value: 5, min: 1, max: 10, step: 1 },
      { type: 'metric', id: 'm1', label: '结果', expr: '10', digits: 2 },
      { type: 'action', id: 'a1', label: '操作', prompt: '继续' },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks.map(b => b.id)).toEqual(['t1', 's1', 'm1', 'a1']);
    expect(blocks.map(b => b.kind)).toEqual(['standalone', 'parameters', 'metrics', 'actions']);
  });

  it('groups contiguous checks and contiguous actions', () => {
    const nodes: UiNode[] = [
      { type: 'check', id: 'c1', label: '选项1', value: false },
      { type: 'check', id: 'c2', label: '选项2', value: true },
      { type: 'action', id: 'a1', label: '确定', prompt: '确定' },
      { type: 'action', id: 'a2', label: '取消', prompt: '取消' },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ id: 'c1', kind: 'checks', nodes: [{ id: 'c1' }, { id: 'c2' }] });
    expect(blocks[1]).toMatchObject({ id: 'a1', kind: 'actions', nodes: [{ id: 'a1' }, { id: 'a2' }] });
  });

  it('handles single metric and standalone complex nodes', () => {
    const nodes: UiNode[] = [
      { type: 'metric', id: 'm1', label: '单个指标', expr: '42', digits: 2 },
      { type: 'chart', id: 'ch1', label: '图表', min: 0, max: 10, series: [{ label: 's', expr: 'x' }] },
      { type: 'table', id: 'tb1', columns: ['A'], rows: [['1']] },
    ];
    const blocks = composeVisualBlocks(nodes);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.kind).toBe('metrics');
    expect(blocks[1]!.kind).toBe('standalone');
    expect(blocks[2]!.kind).toBe('standalone');
  });

  it('keeps block IDs stable when appending new nodes during streaming', () => {
    const step1: UiNode[] = [
      { type: 'slider', id: 's1', label: '参数1', value: 1, min: 1, max: 10, step: 1 },
    ];
    const blocks1 = composeVisualBlocks(step1);
    expect(blocks1[0]!.id).toBe('s1');

    const step2: UiNode[] = [
      ...step1,
      { type: 'number', id: 'n2', label: '参数2', value: 2, min: 1, max: 10, step: 1 },
    ];
    const blocks2 = composeVisualBlocks(step2);
    expect(blocks2).toHaveLength(1);
    expect(blocks2[0]!.id).toBe('s1');
  });
});
