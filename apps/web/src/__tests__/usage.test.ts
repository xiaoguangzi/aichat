import { describe, expect, it } from 'vitest';
import { sumUsage, timingLabel, usageLabel } from '../lib/usage';

it('formats turn timing and avoids invented speeds for absent or incomplete usage', () => {
  const timing = { firstTokenMs: 500, totalMs: 9000, generationMs: 3000, outputTokens: 150, outputComplete: true };
  expect(timingLabel(timing)).toBe('首字 0.50s · 总时间 9.00s · 50.0 token/s');
  expect(timingLabel({ ...timing, outputComplete: false })).toContain('— token/s');
  expect(timingLabel({ ...timing, generationMs: 0 })).toContain('— token/s');
  expect(timingLabel({ ...timing, firstTokenMs: undefined, outputTokens: 0 })).toBe('首字 — · 总时间 9.00s · — token/s');
});

describe('turn usage totals', () => {
  it('keeps unknown cache counters unknown', () => {
    const u = sumUsage([{ input: 100, output: 5 }, { input: 200, output: 7 }])!;
    expect(u.cacheRead).toBeUndefined();
    expect(usageLabel(u)).toContain('缓存未报告');
  });
  it('marks partial sums and missing requests as lower bounds', () => {
    const u = sumUsage([{ input: 100, output: 5, cacheRead: 80 }, { input: 200, output: 7 }, null])!;
    expect(u).toMatchObject({ input: 300, cacheRead: 80, cacheReadComplete: false, usageComplete: false });
    expect(usageLabel(u)).toBe('≥300↑ ≥12↓ · ≥80 cached');
  });
  it('distinguishes an explicit zero from absent usage and preserves cache writes', () => {
    expect(usageLabel({ input: 100, output: 5, cacheRead: 0 })).toContain('0 cached');
    const u = sumUsage([{ input: 100, output: 5, cacheRead: 80, cacheWrite: 10, inputTotalKnown: true }, { input: 200, output: 7, cacheRead: 180, cacheWrite: 0, inputTotalKnown: true }])!;
    expect(usageLabel(u)).toBe('300↑ 12↓ · 260 cached · 10 cache write');
    expect(sumUsage([null, undefined])).toBeUndefined();
  });
});
