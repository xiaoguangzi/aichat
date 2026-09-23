import { useEffect, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Markdown } from '../ui/Markdown';
import { cn } from '../../lib/utils';

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  if (!text.trim() && !streaming) return null;

  return (
    <div
      className={cn(
        'my-2.5 rounded-2xl border text-sm transition-all duration-200 overflow-hidden',
        streaming
          ? 'border-accent-400/50 dark:border-accent-700/50 bg-accent-50/40 dark:bg-accent-950/20 shadow-xs'
          : 'border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
        {streaming && <span className="pulse-dot text-accent-500">···</span>}
        <span className="ml-auto text-[11px] text-zinc-400">
          {open ? 'Hide' : 'Show'}
        </span>
        <ChevronDown
          size={13}
          className={cn('text-zinc-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-zinc-200/70 dark:border-zinc-800 px-4 py-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 [&_.prose-chat]:text-[13px] [&_.prose-chat]:leading-6">
          {text ? <Markdown text={text} live={streaming} /> : <span className="italic text-zinc-400">(no visible content)</span>}
        </div>
      )}
    </div>
  );
}
