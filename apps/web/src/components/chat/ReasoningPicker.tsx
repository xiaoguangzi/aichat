import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { supportedReasoningLevels, type ReasoningLevel } from '@aichat/shared';
import { useChat } from '../../store/chat';
import { useAllModels } from '../../store/settings';
import { defaultReasoning, rememberReasoning } from '../../lib/reasoning';
import { cn } from '../../lib/utils';

const LABELS: Record<ReasoningLevel, string> = {
  off: 'No thinking',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

const DESCRIPTIONS: Record<ReasoningLevel, string> = {
  off: 'Direct response without hidden thinking chain',
  minimal: 'Very concise reasoning for quick checks',
  low: 'Brief thinking for simple reasoning steps',
  medium: 'Balanced thinking depth for standard tasks',
  high: 'Deep multi-step reasoning for complex problems',
  xhigh: 'Extended exploration and verification',
  max: 'Maximum thinking effort and token depth',
};

export function ReasoningPicker() {
  const current = useChat((s) => s.current);
  const draftReasoning = useChat((s) => s.draftReasoning);
  const draftModelId = useChat((s) => s.draftModelId);
  const setDraftReasoning = useChat((s) => s.setDraftReasoning);
  const running = useChat((s) => s.running);
  const updateConversation = useChat((s) => s.updateConversation);
  const models = useAllModels();

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  const activeModelId = current?.modelId ?? draftModelId;
  const model = models.find((m) => m.id === activeModelId) ?? models.find((m) => m.isDefault);
  const levels = model ? supportedReasoningLevels(model) : [];

  // The composer sits inside a scroll container. A portal avoids clipping by that
  // container; viewport bounds determine the opening direction and scroll height.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = popoverRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      if (anchor.bottom < topEdge || anchor.top > bottomEdge) {
        setOpen(false);
        return;
      }
      const above = Math.max(0, anchor.top - topEdge - 8);
      const below = Math.max(0, bottomEdge - anchor.bottom - 8);
      const upwards = above >= 420 || above >= below;
      const width = Math.min(320, rightEdge - leftEdge);
      setPosition({
        left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)),
        width,
        maxHeight: Math.min(420, upwards ? above : below),
        ...(upwards ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
      });
    };
    const onScroll = (event: Event) => {
      // Scrolling options must not reposition or reset the menu.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, levels.length]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!levels.length) return null;

  const value = current?.settings.reasoning ?? draftReasoning ?? defaultReasoning(levels);

  const set = async (level: ReasoningLevel) => {
    rememberReasoning(level);
    if (current) {
      await updateConversation(current.id, { settings: { ...current.settings, reasoning: level } });
    } else {
      setDraftReasoning(level);
    }
    setOpen(false);
  };

  return (
    <div className="relative inline-flex items-center" ref={popoverRef}>
      {/* Visual pill button - modern, clickable, reliable */}
      <button
        type="button"
        disabled={running}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-all duration-150',
          'border border-black/[0.07] dark:border-white/[0.08] bg-white/75 dark:bg-zinc-900/75 backdrop-blur-md',
          'hover:bg-white dark:hover:bg-zinc-800 hover:border-black/[0.12] dark:hover:border-white/[0.15]',
          'text-zinc-700 dark:text-zinc-300 shadow-2xs active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
          open && 'border-accent-500/50 dark:border-accent-500/50 ring-2 ring-accent-500/15 bg-white dark:bg-zinc-800',
        )}
        title="Thinking effort — applies to this conversation, and becomes the default for new ones"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Brain
          size={14}
          className={cn(
            'transition-colors',
            value === 'off'
              ? 'text-zinc-400'
              : 'text-accent-600 dark:text-accent-400 group-hover:text-accent-500',
          )}
        />
        <span className="text-[12px]">{LABELS[value] ?? value}</span>
        <ChevronDown
          size={12}
          className={cn('text-zinc-400 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {/* Modern Popover menu */}
      {open && createPortal(
        <div
          ref={menuRef}
          style={position}
          role="listbox"
          aria-label="Reasoning level"
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 p-1.5 shadow-xl shadow-zinc-950/15 backdrop-blur-md"
        >
          <div className="shrink-0 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Thinking Effort
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain space-y-0.5">
            {levels.map((l) => {
              const active = l === value;
              return (
                <button
                  key={l}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => void set(l)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'bg-accent-50/80 dark:bg-accent-950/50 text-accent-950 dark:text-accent-100'
                      : 'hover:bg-zinc-100/80 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300',
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {active ? (
                      <Check size={14} className="text-accent-600 dark:text-accent-400" />
                    ) : (
                      <div className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-xs font-medium', active && 'font-semibold text-accent-700 dark:text-accent-300')}>
                      {LABELS[l]}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                      {DESCRIPTIONS[l]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

      {/* Semantic hidden select for accessibility and testing compatibility */}
      <select
        value={value}
        disabled={running}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void set(e.target.value as ReasoningLevel)}
        className="sr-only pointer-events-none"
      >
        {levels.map((l) => (
          <option key={l} value={l}>
            {LABELS[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
