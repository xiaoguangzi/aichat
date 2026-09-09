import { useEffect, useId, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, getStoredTheme, onThemeChange } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';

const options = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色模式', icon: Sun },
  { value: 'dark', label: '深色模式', icon: Moon },
] as const;

export function ThemePicker() {
  const [theme, setTheme] = useState(getStoredTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((option) => option.value === theme)!;
  const Icon = current.icon;

  useEffect(() => onThemeChange(() => setTheme(getStoredTheme())), []);
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
      <button ref={trigger} type="button" aria-label={`主题：${current.label}`} title={`主题：${current.label}`}
        aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className="flex rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-accent-500/10 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-accent-500 dark:hover:text-accent-400">
        <Icon size={17} />
      </button>
      {open && <div id={id} role="dialog" aria-label="主题模式"
        className="absolute bottom-full right-0 z-50 mb-3 w-40 rounded-xl border border-zinc-200/80 bg-white p-1.5 shadow-lg shadow-zinc-950/10 dark:border-zinc-700/70 dark:bg-zinc-900 dark:shadow-black/30">
        {options.map(({ value, label, icon: OptionIcon }) => <button key={value} type="button"
          aria-pressed={theme === value}
          onClick={() => { applyTheme(value); setOpen(false); trigger.current?.focus(); }}
          className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent-500',
            theme === value ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800')}>
          <OptionIcon size={15} /><div className="flex-1">{label}</div>{theme === value && <Check size={14} />}
        </button>)}
      </div>}
    </div>
  );
}
