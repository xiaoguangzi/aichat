/**
 * Models are inconsistent about math delimiters: some emit `$…$` / `$$…$$` (what remark-math
 * understands), others emit LaTeX's own `\(…\)` / `\[…\]`, and some drop a bare `\begin{aligned}`
 * environment straight into the text. Normalizing to `$` delimiters before parsing means all
 * three render instead of showing up as raw source.
 *
 * Code must survive untouched — a shell snippet is full of `$VAR` and a LaTeX answer may show
 * `\[` literally — so fenced blocks and inline code spans are masked out before rewriting.
 */

const MATH_ENVS =
  'equation|align|alignat|aligned|gather|gathered|multline|split|cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix';
const BARE_ENV = new RegExp(
  `(^|\\n)([ \\t]*)(\\\\begin\\{(?:${MATH_ENVS})\\*?\\}[^]*?\\\\end\\{(?:${MATH_ENVS})\\*?\\})`,
  'g',
);
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[^]*?\1/g;
const DISPLAY_MATH = /\$\$[^]*?\$\$/g;

/** Masked regions get a sentinel that neither markdown nor the rewrites below can mistake for content. */
const CODE_MARK = '\u0000';
const MATH_MARK = '\u0001';

function mask(text: string, re: RegExp, store: string[], sentinel: string): string {
  return text.replace(re, (m) => `${sentinel}${store.push(m) - 1}${sentinel}`);
}

function unmask(text: string, store: string[], sentinel: string): string {
  const re = new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g');
  let out = text;
  // masked regions nest (inline code inside display math), so restore until nothing is left
  for (let i = 0; i < 3 && out.includes(sentinel); i++) {
    out = out.replace(re, (m, n: string) => store[Number(n)] ?? m);
  }
  return out;
}

/**
 * remark-math would read "it costs $5 and later $10" as a formula. Prose about money is far more
 * common in a chat than prose about math, so a `$…$` pair has to look like math to survive:
 * borrowing markdown-it-katex's rule, a digit right after the closing `$` disqualifies it, as does
 * padding whitespace unless the body carries a LaTeX marker. Everything else is escaped to `\$`,
 * which markdown renders as the plain dollar sign the author meant.
 */
const LATEX_SIGNAL = /[\\^_{]/;

function isMath(body: string, after: string | undefined): boolean {
  if (!body || body.includes('\n\n')) return false;
  if (after !== undefined && after >= '0' && after <= '9') return false;
  return !/^\s|\s$/.test(body) || LATEX_SIGNAL.test(body);
}

function guardDollars(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') {
      out += text.slice(i, i + 2); // an escape sequence, dollar sign or not, passes through whole
      i += 2;
      continue;
    }
    if (ch !== '$') {
      out += ch;
      i += 1;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j += 1;
      else if (text[j] === '$') { close = j; break; }
      else if (text[j] === '\n' && text[j + 1] === '\n') break; // inline math cannot cross a blank line
    }
    if (close > 0 && isMath(text.slice(i + 1, close), text[close + 1])) {
      out += text.slice(i, close + 1);
      i = close + 1;
    } else {
      out += '\\$';
      i += 1;
    }
  }
  return out;
}

/**
 * remark-math only reads `$$…$$` as display math when the delimiters sit on lines of their own —
 * the single-line form models love (`$$x = y$$`) otherwise renders as cramped inline math, and a
 * multi-line one whose formula starts on the opening line does not parse at all.
 */
function blockifyDisplay(text: string): string {
  return text.replace(DISPLAY_MATH, (m, offset: number) => {
    const body = m.slice(2, -2).trim();
    if (!body) return m;
    const before = text.slice(0, offset);
    const after = text.slice(offset + m.length);
    const atLineStart = /(^|\n)[ \t]*$/.test(before);
    const atLineEnd = /^[ \t]*(\n|$)/.test(after);
    // mid-sentence single-line math stays where the author put it; anything else becomes a block
    if (!m.includes('\n') && !(atLineStart && atLineEnd)) return m;
    return `${atLineStart ? '' : '\n'}$$\n${body}\n$$${atLineEnd ? '' : '\n'}`;
  });
}

function rewrite(block: string): string {
  const code: string[] = [];
  const math: string[] = [];
  let out = mask(block, INLINE_CODE, code, CODE_MARK);
  out = mask(out, DISPLAY_MATH, math, MATH_MARK); // so an already-delimited environment is not wrapped twice
  out = out.replace(/\\\[([^]*?)\\\]/g, (_, body: string) => `$$${body.trim()}$$`);
  out = out.replace(/\\\(([^]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
  out = out.replace(BARE_ENV, (_, lead: string, indent: string, env: string) => `${lead}${indent}$$${env}$$`);
  out = mask(out, DISPLAY_MATH, math, MATH_MARK); // re-mask: the rewrites above created new display math
  out = guardDollars(out);
  out = blockifyDisplay(unmask(out, math, MATH_MARK));
  return unmask(out, code, CODE_MARK);
}

/** Rewrites LaTeX delimiters to `$`/`$$` outside of code. Cheap no-op for text with no math markers at all. */
export function normalizeMath(text: string): string {
  if (!text.includes('\\') && !text.includes('$')) return text;

  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (prose.length) out.push(rewrite(prose.join('\n')));
    prose = [];
  };

  for (const line of text.split('\n')) {
    if (fence !== null) {
      out.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      flush();
      out.push(line);
      fence = open[1]!;
      continue;
    }
    prose.push(line);
  }
  flush();
  return out.join('\n');
}
