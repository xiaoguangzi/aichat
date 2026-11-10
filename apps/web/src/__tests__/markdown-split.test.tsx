import { describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CutTracker, settledCuts } from '../lib/markdown-split.js';
import { Markdown } from '../components/ui/Markdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The text before each reported cut, which is how the cuts read to a human. */
const blocks = (text: string) => {
  const { cuts } = settledCuts(text);
  return [0, ...cuts].map((start, i) => text.slice(start, cuts[i] ?? text.length));
};

describe('settled markdown cuts', () => {
  it('cuts between top-level blocks once the next one has started', () => {
    expect(blocks('First paragraph.\n\n## Heading\n\nSecond paragraph is here.\n')).toEqual([
      'First paragraph.\n\n', '## Heading\n\n', 'Second paragraph is here.\n',
    ]);
    // A blank line alone decides nothing: what follows may still belong to the block above.
    expect(settledCuts('First paragraph.\n\n').cuts).toEqual([]);
    expect(settledCuts('First paragraph.\n\n1').cuts).toEqual([]);
  });

  it('keeps lists, their continuations and indented code with the block they belong to', () => {
    expect(settledCuts('- one\n\n- two\n\n  continued\n\n1. three\n').cuts).toEqual([]);
    expect(settledCuts('Intro\n\n    indented code\n').cuts).toEqual([]);
    expect(blocks('- one\n\n- two\n\nAfter the list ends.\n')).toHaveLength(2);
    expect(blocks('**Bold start** of a paragraph\n\n---\n\n-5 degrees outside\n')).toHaveLength(3);
  });

  it('never cuts inside fenced code or display math', () => {
    expect(settledCuts('```ts\nconst a = 1;\n\nconst b = 2;\n```\n').cuts).toEqual([]);
    expect(settledCuts('~~~\ntext\n\n```\nstill code\n\nmore\n').cuts).toEqual([]);
    expect(settledCuts('$$\na = b\n\nc = d\n$$\n').cuts).toEqual([]);
    expect(settledCuts('\\[\na = b\n\nc = d\n\\]\n').cuts).toEqual([]);
    expect(settledCuts('\\begin{aligned}\na\n\nb\n\\end{aligned}\n').cuts).toEqual([]);
    expect(blocks('```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter the code block.\n')).toHaveLength(2);
  });

  it('stops cutting once syntax that reaches across blocks appears', () => {
    const footnote = settledCuts('Intro paragraph.\n\nA claim[^1] with a note.\n\nMore text follows here.\n\n[^1]: The note.\n');
    expect(footnote.sealed).toBe(true);
    expect(footnote.cuts).toHaveLength(1);
    expect(settledCuts('See [the docs][docs].\n\n[docs]: https://example.com\n\nTrailing paragraph.\n').sealed).toBe(true);
    expect(settledCuts('<!-- note\n\nstill a comment -->\n\nParagraph after it.\n').cuts).toEqual([]);
  });

  it('finds the same cuts incrementally as the text grows', () => {
    const text = 'Alpha paragraph.\n\n- a\n- b\n\nBeta paragraph.\n\n```\ncode\n\nmore\n```\n\nGamma paragraph is last.\n';
    const tracker = new CutTracker();
    let last: readonly number[] = [];
    for (let i = 1; i <= text.length; i += 1) {
      const next = tracker.update(text.slice(0, i));
      expect(next.slice(0, last.length)).toEqual(last);
      last = next;
    }
    expect(last).toEqual(settledCuts(text).cuts);
    expect(tracker.update('Different text.\n\nSecond block of it.\n')).toHaveLength(1);
  });
});

async function html(text: string, live: boolean) {
  const el = document.createElement('div');
  const root = createRoot(el);
  await act(async () => root.render(<Markdown text={text} live={live} />));
  const prose = el.querySelector('.prose-chat')!;
  // Whole-document markdown puts a newline between top-level blocks; it has no layout effect.
  for (const node of [...prose.childNodes]) if (node.nodeType === Node.TEXT_NODE && !node.textContent!.trim()) node.remove();
  const out = prose.innerHTML;
  await act(async () => root.unmount());
  return out;
}

describe('block-wise rendering', () => {
  it.each([
    ['prose and headings', '# Title\n\nFirst paragraph with **bold** and `code`.\n\n## Section\n\nSecond paragraph with a [link](https://example.com).\n\nThird.\n'],
    ['lists', 'Intro\n\n- one\n- two\n\n1. first\n\n   continued\n\n2. second\n\nA paragraph after the lists.\n\n- [ ] task\n- [x] done\n'],
    ['code', 'Before the code.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter the code.\n\n    indented block\n\nThe end of it.\n'],
    ['tables and quotes', '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n>\n> still quoted\n\nPlain text again.\n\n---\n\nLast paragraph here.\n'],
    ['math', 'Inline $E = mc^2$ here.\n\n$$\na = b\n\nc = d\n$$\n\n\\[ x^2 \\]\n\nClosing paragraph of math.\n'],
  ])('renders %s exactly as the whole document does', async (_, text) => {
    expect(settledCuts(text).cuts.length).toBeGreaterThan(0);
    expect(await html(text, true)).toBe(await html(text, false));
  });
});
