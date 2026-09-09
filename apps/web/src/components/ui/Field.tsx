import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const inputCls =
  'w-full rounded-xl border border-zinc-200/90 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 shadow-2xs transition-colors placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:outline-none focus:border-accent-500 dark:focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('block', className)}>
      <div className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[11px] leading-4 text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...p} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, 'font-mono text-xs', className)} {...p} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        inputCls,
        'cursor-pointer appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[length:12px] bg-[right_0.6rem_center] bg-no-repeat pr-8',
        className,
      )}
      {...p}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5 text-xs select-none"
    >
      <span
        className={cn(
          'relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-zinc-700',
          'group-hover:bg-accent-500/80 dark:group-hover:bg-zinc-600',
          checked && 'group-hover:bg-accent-500',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-all duration-200',
            checked ? 'left-[1.125rem]' : 'left-0.5',
          )}
        />
      </span>
      {label && <span className="text-zinc-700 dark:text-zinc-300 font-medium">{label}</span>}
    </button>
  );
}
