import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Folder, FolderPlus, X } from 'lucide-react';
import { useChat } from '../../store/chat';
import { cn } from '../../lib/utils';

const MENU_W = 208;

/**
 * Click-driven counterpart to dragging: pick a group for one conversation.
 * Rendered in a portal because the sidebar list is a scroll container that would clip it.
 */
export function GroupMenu({
  conversationId,
  groupId,
  anchor,
  onClose,
}: {
  conversationId: string;
  groupId: string | null;
  /** viewport rect (or a zero-size point, for right-click) the menu hangs off */
  anchor: DOMRect;
  onClose: () => void;
}) {
  const groups = useChat((s) => s.groups);
  const moveConversation = useChat((s) => s.moveConversation);
  const createGroup = useChat((s) => s.createGroup);
  const ref = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });

  // keep the menu inside the viewport (flip above the anchor when it would overflow)
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - MENU_W - 8);
    const below = anchor.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 4) : below;
    setPos({ left, top });
  }, [anchor, groups.length, newName]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      // the button that opened the menu handles its own toggle
      if (t?.closest?.('[data-group-menu-anchor]')) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // capture: rows underneath must not swallow the click that dismisses the menu
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (target: string | null) => {
    onClose();
    void moveConversation(conversationId, target);
  };

  const submitNew = async () => {
    const name = (newName ?? '').trim();
    setNewName(null);
    if (!name) return;
    onClose();
    const g = await createGroup(name);
    await moveConversation(conversationId, g.id);
  };

  const item = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors';

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top, width: MENU_W }}
      className="fixed z-50 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 shadow-lg"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Move to group
      </div>
      <div className="max-h-64 overflow-y-auto">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => pick(g.id)}
            className={cn(item, 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
          >
            <Folder size={13} className="shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate">{g.name}</span>
            {g.id === groupId && <Check size={13} className="shrink-0 text-accent-500" />}
          </button>
        ))}
        {groups.length === 0 && (
          <div className="px-2 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">No groups yet</div>
        )}
      </div>
      {groupId && (
        <button
          type="button"
          onClick={() => pick(null)}
          className={cn(item, 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
        >
          <X size={13} className="shrink-0" />
          <span>Remove from group</span>
        </button>
      )}
      <div className="my-1 border-t border-zinc-200/70 dark:border-zinc-800" />
      {newName === null ? (
        <button
          type="button"
          onClick={() => setNewName('')}
          className={cn(item, 'text-accent-600 dark:text-accent-400 hover:bg-accent-500/10')}
        >
          <FolderPlus size={13} className="shrink-0" />
          <span>New group…</span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-1">
          <FolderPlus size={13} className="shrink-0 text-accent-500" />
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNew();
              if (e.key === 'Escape') { e.stopPropagation(); setNewName(null); }
            }}
            onBlur={() => void submitNew()}
            placeholder="Group name…"
            className="w-full bg-transparent text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
