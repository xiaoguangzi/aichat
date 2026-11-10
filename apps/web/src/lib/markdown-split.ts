/**
 * Finds the points where streaming markdown can be cut into independently rendered blocks.
 *
 * Re-parsing a whole reply on every frame is what makes long answers stutter: the cost grows
 * with everything already written. A block that later text can no longer change only needs to
 * be parsed once, so the live renderer keeps those memoized and re-parses just the tail.
 *
 * A cut is only reported where rendering both sides separately gives the same result as
 * rendering them together. The rules are deliberately conservative — a missed cut costs a
 * little speed, a wrong one shows up as a visual jump when the finished reply is re-rendered
 * whole:
 *   - only at a blank line outside fenced code and display math;
 *   - only when the next line starts a new top-level block (not indented, not a list item,
 *     which could continue a list or a list item above);
 *   - never once the text contains constructs that reach across blocks (footnotes, link
 *     reference definitions, raw HTML blocks that span blank lines).
 */

const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** Long enough to tell a list marker (`123456789. `) from the start of a paragraph. */
const DECIDABLE = 12;
const CROSS_BLOCK = /^ {0,3}(?:<(?:pre|script|style|textarea|!--|\?|![A-Za-z]|!\[CDATA\[)|\[[^\]\n]+\]:)/i;

function count(line: string, needle: string): number {
  let n = 0;
  for (let i = line.indexOf(needle); i >= 0; i = line.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

export interface Cuts {
  /** Offsets, ascending, each the start of a line that begins a new block. */
  cuts: number[];
  /** Cross-block syntax was seen: nothing after the last cut may be split. */
  sealed: boolean;
}

/**
 * Scans `text` from `from` — the start of the text or a previously reported cut, both of which
 * are clean block boundaries — and returns every further safe cut.
 */
export function settledCuts(text: string, from = 0): Cuts {
  const cuts: number[] = [];
  let fence: { char: string; length: number; indent: number } | null = null;
  // Display math may contain blank lines; while any of these is unbalanced we are inside one.
  let dollars = 0;
  let brackets = 0;
  let envs = 0;
  let afterBlank = false;
  let pos = from;

  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const complete = nl >= 0;
    const line = complete ? text.slice(pos, nl) : text.slice(pos);
    const start = pos;
    pos = complete ? nl + 1 : text.length;

    if (fence) {
      const close = FENCE.exec(line);
      if (complete && close && close[2]![0] === fence.char && close[2]!.length >= fence.length &&
        close[1]!.length <= fence.indent + 3 && !close[3]!.trim()) fence = null;
      continue;
    }
    if (!line.trim()) {
      if (complete) afterBlank = true;
      continue;
    }
    // The last line is still being written; its first characters decide what kind of block it is.
    if (!complete && line.length < DECIDABLE) break;

    const clean = dollars % 2 === 0 && brackets === 0 && envs === 0;
    if (afterBlank && clean && line[0] !== ' ' && line[0] !== '\t' && !LIST_ITEM.test(line)) cuts.push(start);
    afterBlank = false;
    if (CROSS_BLOCK.test(line) || line.includes('[^')) return { cuts, sealed: true };
    if (!complete) break;

    const open = FENCE.exec(line);
    if (open && !(open[2]![0] === '`' && open[3]!.includes('`'))) {
      fence = { char: open[2]![0]!, length: open[2]!.length, indent: open[1]!.length };
      continue;
    }
    dollars += count(line, '$$');
    brackets += count(line, '\\[') - count(line, '\\]');
    envs += count(line, '\\begin{') - count(line, '\\end{');
  }
  return { cuts, sealed: false };
}

/** Incremental wrapper: remembers the cuts of a growing text and only scans what is new. */
export class CutTracker {
  private text = '';
  private found: number[] = [];
  private sealed = false;

  update(text: string): readonly number[] {
    if (text === this.text) return this.found;
    if (!text.startsWith(this.text)) {
      this.found = [];
      this.sealed = false;
    }
    this.text = text;
    if (!this.sealed) {
      const next = settledCuts(text, this.found[this.found.length - 1] ?? 0);
      if (next.cuts.length) this.found = [...this.found, ...next.cuts];
      this.sealed = next.sealed;
    }
    return this.found;
  }
}
