import { cn } from '../../lib/utils';

/** Gradient brand mark used in the sidebar and the chat empty state. */
export function LogoMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'h-5 w-5 rounded-md', md: 'h-7 w-7 rounded-lg', lg: 'h-12 w-12 rounded-2xl' }[size];
  const icon = { sm: 12, md: 16, lg: 26 }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-gradient-to-tr from-accent-600 to-accent-400 text-white shadow-sm shadow-accent-600/20', s, className)}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor" stroke="none" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
