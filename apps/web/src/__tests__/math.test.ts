import { describe, it, expect } from 'vitest';
import { normalizeMath } from '../lib/math';

describe('normalizeMath', () => {
  it('rewrites LaTeX delimiters to $ delimiters', () => {
    expect(normalizeMath(String.raw`能量是 \(E = mc^2\) 。`)).toBe('能量是 $E = mc^2$ 。');
    // display math has to sit on its own lines for remark-math to treat it as a block
    expect(normalizeMath(String.raw`\[ \alpha_{t,i} = \mathrm{softmax}(x) \]`)).toBe(
      ['$$', String.raw`\alpha_{t,i} = \mathrm{softmax}(x)`, '$$'].join('\n'),
    );
  });

  it('handles display math spanning several lines', () => {
    const src = ['前面', String.raw`\[`, 'a = b', String.raw`\]`, '后面'].join('\n');
    expect(normalizeMath(src)).toBe(['前面', '$$', 'a = b', '$$', '后面'].join('\n'));
  });

  it('wraps a bare math environment', () => {
    const src = String.raw`\begin{aligned} a &= b \\ c &= d \end{aligned}`;
    expect(normalizeMath(src)).toBe(['$$', src, '$$'].join('\n'));
  });

  it('does not re-wrap an environment that is already delimited', () => {
    const inner = String.raw`\begin{aligned} a &= b \end{aligned}`;
    expect(normalizeMath(`$$${inner}$$`)).toBe(['$$', inner, '$$'].join('\n'));
  });

  it('leaves $$ that is mid-sentence inline', () => {
    const src = 'see $$x$$ here';
    expect(normalizeMath(src)).toBe(src);
  });

  it('leaves fenced code untouched', () => {
    const src = ['```bash', String.raw`echo \(not math\)`, 'PATH=$HOME', '```'].join('\n');
    expect(normalizeMath(src)).toBe(src);
  });

  it('leaves inline code untouched but still rewrites around it', () => {
    const src = 'use `\\(x\\)` for \\(y\\)';
    expect(normalizeMath(src)).toBe('use `\\(x\\)` for $y$');
  });

  it('escapes dollar signs that are prices, not math', () => {
    expect(normalizeMath('It costs $5 and later $10 per seat.')).toBe(
      'It costs \\$5 and later \\$10 per seat.',
    );
    expect(normalizeMath('the cost is $30 and the rate is $x$')).toBe(
      'the cost is \\$30 and the rate is $x$',
    );
  });

  it('keeps real inline math, padded or not', () => {
    expect(normalizeMath(String.raw`$x^2$ and $ \alpha $`)).toBe(String.raw`$x^2$ and $ \alpha $`);
  });

  it('keeps text without any math markers unchanged', () => {
    const src = 'plain text, nothing to do';
    expect(normalizeMath(src)).toBe(src);
  });
});
