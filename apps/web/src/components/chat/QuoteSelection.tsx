import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';

/** Only selections contained in an assistant text block can become a quote. */
export function selectedReply(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element : range.startContainer.parentElement;
  const block = element?.closest('[data-quote-text]');
  return block && root.contains(block) && block.contains(range.endContainer) ? range : null;
}

export function QuoteSelection({ children, onQuote }: { children: ReactNode; onQuote: (text: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const close = () => setQuote(null);
    const update = () => {
      const range = root.current && selectedReply(root.current);
      if (!range) { close(); return; }
      const rect = range.getBoundingClientRect();
      setQuote({ text: window.getSelection()!.toString(), x: rect.left, y: rect.bottom + 8 });
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const down = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node)) close(); };
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerup', update);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerup', update);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col" onContextMenu={(event) => {
      const range = root.current && selectedReply(root.current);
      // Shift + right click always retains the browser menu.
      if (!range || event.shiftKey) { setQuote(null); return; }
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const inside = Array.from(range.getClientRects()).some((rect) =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
      if (!keyboard && !inside) { setQuote(null); return; }
      event.preventDefault();
      const rect = range.getBoundingClientRect();
      setQuote({ text: window.getSelection()!.toString(), x: keyboard ? rect.left : event.clientX, y: keyboard ? rect.bottom : event.clientY });
      requestAnimationFrame(() => button.current?.focus({ preventScroll: true }));
    }}>
      {children}
      {quote && createPortal(
        <button
          ref={button}
          type="button"
          aria-label="引用选中内容"
          title="引用选中内容（Shift + 右键打开浏览器菜单）"
          className="fixed z-50 flex h-9 w-28 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 shadow-lg hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          style={{ left: Math.max(8, Math.min(quote.x, window.innerWidth - 120)), top: Math.max(8, Math.min(quote.y, window.innerHeight - 44)) }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => { onQuote(quote.text); setQuote(null); window.getSelection()?.removeAllRanges(); }}
        >
          <Quote size={15} /> 引用
        </button>, document.body,
      )}
    </div>
  );
}
