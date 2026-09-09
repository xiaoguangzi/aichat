import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 ring-accent-500/40 select-none';
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-xs';
  const variants: Record<Variant, string> = {
    primary:
      'bg-accent-600 text-white shadow-2xs shadow-accent-600/30 hover:bg-accent-500 active:bg-accent-700',
    secondary:
      'bg-white dark:bg-zinc-800/90 text-zinc-800 dark:text-zinc-200 border border-zinc-200/90 dark:border-zinc-700/80 shadow-2xs hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600',
    ghost:
      'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-zinc-100',
    danger:
      'bg-red-600 text-white shadow-2xs shadow-red-600/25 hover:bg-red-500 active:bg-red-700',
  };
  return <button className={cn(base, sizes, variants[variant], className)} {...props} />;
}
