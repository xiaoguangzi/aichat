import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { type Theme } from '../../lib/theme.js';
import { SKINS } from '../../lib/skins.js';
import { useAppearance } from '../../lib/use-appearance.js';
import { cn } from '../../lib/utils.js';

const modes = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
] as const;

export function ThemePicker() {
  const { theme, skin, resolved, setTheme, setSkin } = useAppearance();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const currentMode = modes.find((m) => m.value === theme)!;
  const currentSkin = SKINS.find((s) => s.id === skin)!;
  const Icon = currentMode.icon;

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" aria-label={`外观：${currentSkin.name} · ${currentMode.label}`} title={`外观：${currentSkin.name} · ${currentMode.label}`}
        aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className="flex rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-accent-500/10 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-accent-500 dark:hover:text-accent-400">
        <Icon size={17} />
      </button>
      {open && <div id={id} role="dialog" aria-label="外观"
        className="absolute bottom-full right-0 z-50 mb-3 w-64 rounded-xl border border-zinc-200/80 bg-white p-3 shadow-lg shadow-zinc-950/10 dark:border-zinc-700/70 dark:bg-zinc-900 dark:shadow-black/30">
        <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">明暗模式</p>
        <div role="group" aria-label="明暗模式" className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-zinc-100/80 p-1 dark:bg-zinc-800/70">
          {modes.map(({ value, label, icon: ModeIcon }) => (
            <button key={value} type="button" aria-pressed={theme === value} title={label}
              onClick={() => setTheme(value as Theme)}
              className={cn('flex flex-col items-center gap-1 rounded-md py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent-500',
                theme === value ? 'bg-white text-accent-700 shadow-2xs dark:bg-zinc-900 dark:text-accent-300' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100')}>
              <ModeIcon size={15} />{label}
            </button>
          ))}
        </div>
        <p className="mb-1.5 flex items-baseline justify-between px-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          配色主题{resolved === 'dark' && <span className="font-normal normal-case tracking-normal">仅作用于浅色模式</span>}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {SKINS.map((s) => {
            const v = s.light;
            const active = s.id === skin;
            return (
              <button key={s.id} type="button" aria-pressed={active} aria-label={`${s.name}主题`} title={s.tagline}
                onClick={() => setSkin(s.id)}
                className={cn('flex flex-col gap-1.5 rounded-lg border p-1.5 transition-all focus-visible:outline-2 focus-visible:outline-accent-500',
                  active ? 'border-accent-500 bg-accent-50/60 dark:bg-accent-500/10' : 'border-zinc-200/80 hover:border-accent-400 dark:border-zinc-700/70')}>
                <span className="flex justify-center gap-1">
                  <i className="h-4 w-4 rounded-[5px] border border-black/10 dark:border-white/10" style={{ background: v.chat.bg }} />
                  <i className="h-4 w-4 rounded-[5px] border border-black/10 dark:border-white/10" style={{ background: v.chat.surface }} />
                  <i className="h-4 w-4 rounded-[5px]" style={{ background: v.accent[5] }} />
                </span>
                <span className={cn('flex items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-accent-700 dark:text-accent-300' : 'text-zinc-600 dark:text-zinc-300')}>
                  {s.name}{active && <Check size={11} />}
                </span>
              </button>
            );
          })}
        </div>
        <Link to="/settings/appearance" onClick={() => setOpen(false)}
          className="mt-3 flex items-center gap-2 rounded-lg border-t border-zinc-200/70 px-0.5 pt-2.5 text-xs font-medium text-zinc-600 transition-colors hover:text-accent-600 dark:border-zinc-700/60 dark:text-zinc-300 dark:hover:text-accent-400">
          <Palette size={14} />更多外观设置<ArrowRight size={13} className="ml-auto" />
        </Link>
      </div>}
    </div>
  );
}
