import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, wide, busy = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  close.current = onClose;
  locked.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (!locked.current) close.current(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex="0"]') ?? []).filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { e.preventDefault(); panel.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} className={`pop-in w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-3xl border border-zinc-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl shadow-black/30 outline-none`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-6 py-4">
          <h2 id={titleId} className="min-w-0 break-words text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
          <button type="button" aria-label="关闭弹窗" disabled={busy} onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40"><X size={15} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
