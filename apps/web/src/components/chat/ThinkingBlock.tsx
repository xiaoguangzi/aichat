import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Markdown } from '../ui/Markdown';
import { Collapse } from '../ui/Collapse.js';
import { cn } from '../../lib/utils';

/** `defaultOpen` keeps short summaries readable once their collapsed process is expanded. */
export function ThinkingBlock({ text, streaming, defaultOpen = false }: { text: string; streaming: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(streaming || defaultOpen);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  // Only a block that started while it was being written arrives with motion; history just is.
  const [arrived] = useState(streaming);

  useEffect(() => {
    if (!streaming && !defaultOpen) setOpen(false);
  }, [streaming, defaultOpen]);

  // The streaming view is capped at max-h-80, so later reasoning would otherwise accumulate
  // below the fold. Keep the newest text visible until the reader scrolls back through it.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !open || !streaming || !follow.current) return;
    el.scrollTop = el.scrollHeight;
    // Scroll events arrive asynchronously, after this function has returned.
    lastTop.current = Math.max(0, el.scrollTop);
  }, [text, open, streaming]);

  useEffect(() => {
    const el = body.current;
    if (!el || !open) return;
    const onScroll = () => {
      const top = Math.max(0, el.scrollTop);
      const delta = top - lastTop.current;
      if (delta < 0) follow.current = false;
      else if (delta > 0) follow.current = el.scrollHeight - top - el.clientHeight < 24;
      lastTop.current = top;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) follow.current = false;
    };
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY !== undefined && touchY !== undefined && nextY > touchY) follow.current = false;
      touchY = nextY;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [open]);

  if (!text.trim() && !streaming) return null;

  return (
    <div
      className={cn(
        'thinking-block my-2.5 rounded-2xl border text-sm overflow-hidden',
        arrived && 'block-enter',
        streaming
          ? 'border-accent-400/50 dark:border-accent-700/50 bg-accent-50/40 dark:bg-accent-950/20 shadow-xs'
          : 'border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/40',
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (!open) follow.current = true;
          setOpen(!open);
        }}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-xs text-zinc-600 dark:text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
      >
        <div
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-md',
            streaming
              ? 'bg-accent-500/15 text-accent-600 dark:text-accent-400'
              : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500',
          )}
        >
          <Brain size={12} className={cn(streaming && 'pulse-dot')} />
        </div>
        <span className="font-medium">{streaming ? 'Thinking…' : 'Thought process'}</span>
        <span className="ml-auto text-[11px] text-zinc-400">
          {open ? 'Hide' : 'Show'}
        </span>
        <ChevronDown
          size={13}
          className={cn('chevron text-zinc-400', open && 'rotate-180')}
        />
      </button>
      <Collapse open={open}>
        <div ref={body} data-thinking-body className="max-h-80 overflow-y-auto border-t border-zinc-200/70 dark:border-zinc-800 px-4 py-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 [&_.prose-chat]:text-[13px] [&_.prose-chat]:leading-6">
          {text ? <Markdown text={text} live={streaming} /> : <span className="italic text-zinc-400">(no visible content)</span>}
        </div>
      </Collapse>
    </div>
  );
}
