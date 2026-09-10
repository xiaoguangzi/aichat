import type { StreamEvent } from '@aichat/shared';

/**
 * Reasoning that leaks into the answer text as `<think>…</think>`.
 *
 * A model whose chat template opens the tag itself (DeepSeek-R1 and the many gateways that
 * re-host it) emits its reasoning as ordinary `content`, terminated by a bare `</think>` — no
 * `reasoning_content` field, and often no opening tag either, because the template already
 * consumed it. Rendered as-is the whole chain of thought lands in the answer bubble with a
 * stray `</think>` in the middle of it.
 *
 * This filter sits between any adapter and the agent loop (protocol-agnostic: the same gateway
 * quirk shows up behind both wire formats) and routes that text to thinking instead:
 *
 *  - `<think>` at the very start of the message opens a thinking span, `</think>` closes it;
 *  - a bare `</think>` with no opener means the text so far *was* the reasoning, so a
 *    `thinking_reclassify` event tells the consumer to move it into a thinking block.
 *
 * Both are deliberately narrow, so a model that merely writes about the tags keeps its text:
 * an opener only counts at the start of the message, and the bare-close rescue happens at most
 * once per message and never once the provider has sent real thinking of its own.
 * Tags inside Markdown inline code or fenced code blocks are always literal.
 */
const OPEN = ['<think>', '<thinking>'];
const CLOSE = ['</think>', '</thinking>'];
const MAX_TAG = Math.max(...[...OPEN, ...CLOSE].map((t) => t.length));

/** How much of the tail could still turn into a tag once the next delta arrives. */
function heldBack(s: string): number {
  for (let n = Math.min(MAX_TAG - 1, s.length); n > 0; n--) {
    const tail = s.slice(s.length - n);
    if ([...OPEN, ...CLOSE].some((t) => t.startsWith(tail))) return n;
  }
  return 0;
}

/** Incremental Markdown code tracking, including delimiters split across deltas. */
class CodeContext {
  private inline = 0;
  private fence = '';
  private fenceLength = 0;
  private run = '';
  private runLength = 0;
  private runAtLineStart = false;
  private lineStart = true;
  private indent = 0;

  clone(): CodeContext { return Object.assign(new CodeContext(), this); }

  get inCode(): boolean { return this.inline > 0 || !!this.fence; }

  private finishRun() {
    if (!this.runLength) return;
    if (this.fence) {
      if (this.runAtLineStart && this.run === this.fence && this.runLength >= this.fenceLength) {
        this.fence = '';
      }
    } else if (this.inline) {
      if (this.run === '`' && this.runLength === this.inline) this.inline = 0;
    } else if (this.runAtLineStart && this.runLength >= 3) {
      this.fence = this.run;
      this.fenceLength = this.runLength;
    } else if (this.run === '`') {
      this.inline = this.runLength;
    }
    this.run = '';
    this.runLength = 0;
  }

  consume(char: string) {
    if (char !== this.run) this.finishRun();
    if (char === '`' || char === '~') {
      if (!this.runLength) {
        this.run = char;
        this.runAtLineStart = this.lineStart && this.indent <= 3;
      }
      this.runLength++;
    }
    if (char === '\n') {
      this.lineStart = true;
      this.indent = 0;
    } else if (this.lineStart && char === ' ') {
      this.indent++;
    } else {
      this.lineStart = false;
    }
  }

  firstTag(s: string, tags: string[]): { idx: number; tag: string } | null {
    const context = this.clone();
    for (let idx = 0; idx < s.length; idx++) {
      context.consume(s[idx]!);
      if (s[idx] !== '<' || context.inCode) continue;
      const tag = tags.find((candidate) => s.startsWith(candidate, idx));
      if (tag) return { idx, tag };
    }
    return null;
  }
}

export class ThinkTagSplitter {
  private buf = '';
  private code = new CodeContext();
  private mode: 'text' | 'thinking' = 'text';
  /** the provider sent thinking through its own field, so bare `</think>` in text is literal */
  private nativeThinking = false;
  private reclassified = false;
  /** whether any non-blank text has been emitted; an opener past that point is literal */
  private started = false;

  /** Feed one unified event; returns what the consumer should see instead. */
  push(ev: StreamEvent): StreamEvent[] {
    if (ev.type === 'thinking_delta') {
      if (ev.text) this.nativeThinking = true;
      return [ev];
    }
    // usage can land between two halves of a tag; a tool call or the end of the message cannot
    if (ev.type === 'usage') return [ev];
    if (ev.type !== 'text_delta') return [...this.flush(), ev];
    this.buf += ev.text;
    return this.drain();
  }

  private drain(): StreamEvent[] {
    const out: StreamEvent[] = [];
    for (;;) {
      if (this.mode === 'thinking') {
        const close = this.code.firstTag(this.buf, CLOSE);
        if (!close) break;
        this.emit(out, this.buf.slice(0, close.idx));
        this.buf = this.buf.slice(close.idx + close.tag.length);
        this.mode = 'text';
        continue;
      }
      const open = this.code.firstTag(this.buf, OPEN);
      const close = this.code.firstTag(this.buf, CLOSE);
      const canOpen = !!open && !this.started && this.buf.slice(0, open.idx).trim() === '';
      const canClose = !!close && !this.reclassified && !this.nativeThinking;
      if (canOpen && (!canClose || open!.idx < close!.idx)) {
        this.emit(out, this.buf.slice(0, open!.idx));
        this.buf = this.buf.slice(open!.idx + open!.tag.length);
        this.mode = 'thinking';
        continue;
      }
      if (canClose) {
        // everything streamed so far was the reasoning, not the answer
        this.emit(out, this.buf.slice(0, close!.idx));
        out.push({ type: 'thinking_reclassify' });
        this.buf = this.buf.slice(close!.idx + close!.tag.length).replace(/^\s+/, '');
        this.reclassified = true;
        this.started = false;
        continue;
      }
      break;
    }
    const keep = heldBack(this.buf);
    this.emit(out, keep ? this.buf.slice(0, this.buf.length - keep) : this.buf);
    this.buf = keep ? this.buf.slice(this.buf.length - keep) : '';
    return out;
  }

  /** Emit whatever is buffered; a tag cannot survive across this boundary. */
  flush(): StreamEvent[] {
    const out: StreamEvent[] = [];
    this.emit(out, this.buf);
    this.buf = '';
    return out;
  }

  private emit(out: StreamEvent[], text: string) {
    if (!text) return;
    for (const char of text) this.code.consume(char);
    if (this.mode === 'thinking') out.push({ type: 'thinking_delta', text });
    else {
      if (text.trim()) this.started = true;
      out.push({ type: 'text_delta', text });
    }
  }
}

/** Wrap an adapter stream so leaked `<think>` spans arrive as thinking. */
export async function* splitInlineThinking(src: AsyncIterable<StreamEvent>): AsyncIterable<StreamEvent> {
  const splitter = new ThinkTagSplitter();
  for await (const ev of src) yield* splitter.push(ev);
  yield* splitter.flush();
}
