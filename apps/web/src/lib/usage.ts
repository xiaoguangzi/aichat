import type { Usage } from '@aichat/shared';

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
