import { expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContextEstimate } from '@aichat/shared';
import { ContextMeter } from '../components/chat/ContextMeter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estimate = (over: Partial<ContextEstimate> = {}): ContextEstimate => ({
  system: 1_000, tools: 2_000, history: 30_000, total: 33_000,
  budget: 128_000, reservedOutput: 64_000, ratio: 33_000 / 128_000, ...over,
});

async function render(value: ContextEstimate | null) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ContextMeter estimate={value} />));
  return { host, root };
}

it('shows a rounded count and percentage against the declared window', async () => {
  const { host, root } = await render(estimate());
  expect(host.textContent).toBe('33.0k · 26%');
  expect(host.querySelector('[title]')?.getAttribute('title')).toContain('模型声明的上下文窗口 128,000');
  await act(async () => root.unmount());
  host.remove();
});

it('shows only the estimate when no window is declared', async () => {
  const { host, root } = await render(estimate({ budget: null, ratio: null }));
  // No fabricated denominator, and therefore no bar either.
  expect(host.textContent).toBe('33.0k');
  expect(host.querySelector('[title]')?.getAttribute('title')).toContain('未填写上下文窗口');
  expect(host.querySelectorAll('span[style]').length).toBe(0);
  await act(async () => root.unmount());
  host.remove();
});

it('renders nothing before a request has been assembled', async () => {
  const { host, root } = await render(null);
  expect(host.textContent).toBe('');
  await act(async () => root.unmount());
  host.remove();
});

it('flags a nearly full window without claiming to be exact', async () => {
  const { host, root } = await render(estimate({ total: 120_000, ratio: 0.95 }));
  expect(host.textContent).toContain('95%');
  const title = host.querySelector('[title]')!.getAttribute('title')!;
  expect(title).toContain('不是上游的精确计数');
  // The breakdown is available on hover rather than crowding the composer.
  expect(title).toContain('历史 30,000');
  await act(async () => root.unmount());
  host.remove();
});
