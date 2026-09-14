import type { TurnTiming, Usage } from '@aichat/shared';

export function timingLabel(t: TurnTiming): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
  const speed = t.outputComplete && t.outputTokens > 0 && t.generationMs > 0
    ? `${(t.outputTokens * 1000 / t.generationMs).toFixed(1)} token/s` : '— token/s';
  return `首字 ${t.firstTokenMs === undefined ? '—' : seconds(t.firstTokenMs)} · 总时间 ${seconds(t.totalMs)} · ${speed}`;
}

export function sumUsage(items: Array<Usage | null | undefined>): Usage | undefined {
  const known = items.filter((u): u is Usage => u != null);
  if (!known.length) return undefined;
  const complete = known.length === items.length;
  const optionalSum = (key: 'cacheRead' | 'cacheWrite' | 'inputUncached') => {
    const values = known.map(u => u[key]).filter((n): n is number => n !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  return {
    input: known.reduce((n, u) => n + u.input, 0), output: known.reduce((n, u) => n + u.output, 0),
    usageComplete: complete && known.every(u => u.usageComplete !== false),
    inputTotalKnown: complete && known.every(u => u.inputTotalKnown === true),
    cacheRead: optionalSum('cacheRead'), cacheWrite: optionalSum('cacheWrite'),
    cacheReadComplete: complete && known.every(u => u.cacheRead !== undefined && u.cacheReadComplete !== false),
    cacheWriteComplete: complete && known.every(u => u.cacheWrite !== undefined && u.cacheWriteComplete !== false),
    inputUncached: complete && known.every(u => u.inputUncached !== undefined) ? optionalSum('inputUncached') : undefined,
  };
}

export function usageLabel(u: Usage): string {
  const input = `${u.inputTotalKnown === false || u.usageComplete === false ? '≥' : ''}${u.input}↑`;
  const output = `${u.usageComplete === false ? '≥' : ''}${u.output}↓`;
  const cache = u.cacheRead === undefined ? '缓存未报告' : `${u.cacheReadComplete === false ? '≥' : ''}${u.cacheRead} cached`;
  const write = u.cacheWrite ? ` · ${u.cacheWriteComplete === false ? '≥' : ''}${u.cacheWrite} cache write` : '';
  return `${input} ${output} · ${cache}${write}`;
}
