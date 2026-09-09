import type { SkillInfo } from '@aichat/shared';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

export function SlashMenu({
  skills,
  query,
  active,
  onPick,
}: {
  skills: SkillInfo[];
  query: string;
  active: number;
  onPick: (name: string) => void;
}) {
  const list = skills.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  if (!list.length) return null;

  return (
    <div className="pop-in absolute bottom-full left-0 mb-2 w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 p-1.5 shadow-xl shadow-zinc-950/15 backdrop-blur-md z-30">
      <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Available Skills
      </div>
      <div className="max-h-64 overflow-y-auto space-y-0.5">
        {list.slice(0, 8).map((s, i) => (
          <button
            key={s.name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(s.name);
            }}
            className={cn(
              'flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
              i === active
                ? 'bg-accent-50/80 dark:bg-accent-950/50 text-accent-950 dark:text-accent-100'
                : 'hover:bg-zinc-100/80 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300',
            )}
          >
            <div className="mt-0.5 shrink-0 text-accent-500">
              <Sparkles size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn('font-mono text-xs font-medium', i === active && 'text-accent-600 dark:text-accent-400 font-semibold')}>
                /{s.name}
              </div>
              <div className="line-clamp-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {s.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
