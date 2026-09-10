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
 * All three rules are deliberately narrow, so a model that merely writes about the tags keeps its
 * text: an opener only counts at the start of the message; the bare-close rescue happens at most
 * once per message and never once the provider has sent real thinking of its own; and a tag inside
 * Markdown inline code or a fenced block is literal wherever it appears, since quoting is how a
 * model talks about a tag rather than emitting one.
 */
const OPEN = ['<think>', '<thinking>'];
const CLOSE = ['</think>', '</thinking>'];
const MAX_TAG = Math.max(...[...OPEN, ...CLOSE].map((t) => t.length));

type Hit = { idx: number; tag: string };

/** How much of the tail could still turn into a tag once the next delta arrives. */
function heldBack(s: string): number {
  for (let n = Math.min(MAX_TAG - 1, s.length); n > 0; n--) {
    const tail = s.slice(s.length - n);
    if ([...OPEN, ...CLOSE].some((t) => t.startsWith(tail))) return n;
  }
  return 0;
}

function hitAt(s: string, idx: number, tags: string[]): Hit | null {
  const tag = tags.find((candidate) => s.startsWith(candidate, idx));
  return tag ? { idx, tag } : null;
}

/** Incremental Markdown code tracking, including delimiters split across deltas. */
class CodeContext {
  private inline = 0;
  /** the delimiter run that opened the current fence, empty outside one */
  private fence = '';
  /** the run of `` ` ``/`~` being accumulated, empty between runs */
  private run = '';
  private runAtLineStart = false;
  private lineStart = true;
  private indent = 0;

  clone(): CodeContext { return Object.assign(new CodeContext(), this); }

  get inCode(): boolean { return this.inline > 0 || !!this.fence; }

  private finishRun() {
    if (!this.run) return;
    if (this.fence) {
      if (this.runAtLineStart && this.run[0] === this.fence[0] && this.run.length >= this.fence.length) {
        this.fence = '';
      }
    } else if (this.inline) {
      if (this.run[0] === '`' && this.run.length === this.inline) this.inline = 0;
    } else if (this.runAtLineStart && this.run.length >= 3) {
      this.fence = this.run;
    } else if (this.run[0] === '`') {
      this.inline = this.run.length;
    }
    this.run = '';
  }

  consume(char: string) {
    if (char !== this.run[0]) this.finishRun();
    if (char === '`' || char === '~') {
      if (!this.run) this.runAtLineStart = this.lineStart && this.indent <= 3;
      this.run += char;
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

  /**
   * First hit of each requested list that is not inside code. Both lists are found in one walk;
   * a list the caller could not act on is skipped, and `null` for it means "do not look".
   */
  scan(s: string, wantOpen: boolean, wantClose: boolean): { open: Hit | null; close: Hit | null } {
    const context = this.clone();
    let open: Hit | null = null;
    let close: Hit | null = null;
    for (let idx = 0; idx < s.length; idx++) {
      const char = s[idx]!;
      context.consume(char);
      if (char !== '<' || context.inCode) continue;
      if (wantOpen && !open) open = hitAt(s, idx, OPEN);
      if (wantClose && !close) close = hitAt(s, idx, CLOSE);
      if ((open || !wantOpen) && (close || !wantClose)) break;
    }
    return { open, close };
  }
}

export class ThinkTagSplitter {
  private buf = '';
  /** tracks the text already emitted, so `scan` can tell a quoted tag from a real one */
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
      // only look for a tag the state machine could still act on; once neither is live, so is this
      const wantOpen = this.mode === 'text' && !this.started;
      const wantClose = this.mode === 'thinking' || (!this.reclassified && !this.nativeThinking);
      if (!wantOpen && !wantClose) break;
      const { open, close } = this.code.scan(this.buf, wantOpen, wantClose);
      if (this.mode === 'thinking') {
        if (!close) break;
        this.emit(out, this.buf.slice(0, close.idx));
        this.buf = this.buf.slice(close.idx + close.tag.length);
        this.mode = 'text';
        continue;
      }
      const canOpen = open && this.buf.slice(0, open.idx).trim() === '' ? open : null;
      if (canOpen && (!close || canOpen.idx < close.idx)) {
        this.emit(out, this.buf.slice(0, canOpen.idx));
        this.buf = this.buf.slice(canOpen.idx + canOpen.tag.length);
        this.mode = 'thinking';
        continue;
      }
      if (close) {
        // everything streamed so far was the reasoning, not the answer
        this.emit(out, this.buf.slice(0, close.idx));
        out.push({ type: 'thinking_reclassify' });
        this.buf = this.buf.slice(close.idx + close.tag.length).replace(/^\s+/, '');
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
    // the context must advance over exactly the text that leaves the buffer, and no more
    for (let i = 0; i < text.length; i++) this.code.consume(text[i]!);
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
