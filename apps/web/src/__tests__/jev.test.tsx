import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JevPage } from '../pages/JevPage.js';
import { api } from '../api/client.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api.jev, 'settings').mockResolvedValue({ model: 'jev-latest', hasApiKey: true });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const mount = () => act(async () => root.render(<JevPage />));
const click = (label: string) => act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!.click());
async function change(label: string, value: string) {
  await act(async () => {
    const el = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('runs all three question types and displays probabilities, score, actual model and absent usage', async () => {
  const evaluate = vi.spyOn(api.jev, 'evaluate').mockResolvedValue({ elapsedMs: 143, response: {
    model: 'jev-1.13.0', answers: {
      refund: { type: 'noul', noul: 0.93 },
      department: { type: 'choice', choice: 'billing', confidence: 0.8, probabilities: { billing: 0.9, other: 0.1 } },
      urgency: { type: 'score', score: 1.7, confidence: 0.6, probabilities: { '0': 0.1, '1': 0.1, '2': 0.8 }, legend: { '0': 'Can wait', '1': 'Soon', '2': 'Now' } },
    },
  } });
  await mount(); await click('运行决策');
  expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ model: 'jev-latest', questions: expect.objectContaining({ refund: expect.objectContaining({ type: 'noul' }), urgency: expect.objectContaining({ type: 'score' }), department: expect.objectContaining({ type: 'choice' }) }) }));
  expect(host.textContent).toContain('是的概率 93.0%'); expect(host.textContent).toContain('评分 1.7');
  expect(host.textContent).toContain('jev-1.13.0 · 143 ms'); expect(host.textContent).toContain('输入 — tokens');
});
it('keeps malformed JSON local and enables retry after a request failure', async () => {
  const evaluate = vi.spyOn(api.jev, 'evaluate').mockRejectedValue(new Error('Jev 请求失败（HTTP 429）'));
  await mount(); await change('Questions', '{'); await click('运行决策');
  expect(evaluate).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('JSON 格式不正确');
  await click('载入示例'); await click('运行决策');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('HTTP 429');
  await click('运行决策'); expect(evaluate).toHaveBeenCalledTimes(2);
});
it('clears the password input after saving and preserves the key on model-only updates', async () => {
  const save = vi.spyOn(api.jev, 'saveSettings').mockImplementation(async input => ({ model: input.model, hasApiKey: input.apiKey !== null }));
  await mount(); await change('TypeSafe API Key', 'new-test-key'); await click('保存连接');
  expect(save).toHaveBeenLastCalledWith({ model: 'jev-latest', apiKey: 'new-test-key' });
  expect(host.querySelector<HTMLInputElement>('[aria-label="TypeSafe API Key"]')?.value).toBe('');
  await change('Jev 模型', 'jev-1.13.0'); await click('保存连接');
  expect(save).toHaveBeenLastCalledWith({ model: 'jev-1.13.0', apiKey: undefined });
  await click('清除密钥'); expect(save).toHaveBeenLastCalledWith({ model: 'jev-1.13.0', apiKey: null });
  expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === '运行决策')?.disabled).toBe(true);
});
