import { resolveChatModel } from '../../lib/chat-model.js';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Sparkles, Wrench, Eye } from 'lucide-react';
import { useAllModels } from '../../store/settings';
import { useChat } from '../../store/chat';
import { cn } from '../../lib/utils';

export function ModelPicker() {
  const models = useAllModels();
  const current = useChat((s) => s.current);
  const draftModelId = useChat((s) => s.draftModelId);
  const setDraftModelId = useChat((s) => s.setDraftModelId);
  const updateConversation = useChat((s) => s.updateConversation);
  const running = useChat((s) => s.running);

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentModel = resolveChatModel(models, current?.modelId ?? draftModelId);
  const selectedModelId = currentModel?.id ?? '';

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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

  const selectModel = async (id: string) => {
    if (current) {
      await updateConversation(current.id, { modelId: id });
    } else {
      setDraftModelId(id);
    }
    setOpen(false);
  };

  return (
    <div className="relative inline-flex items-center" ref={popoverRef}>
      {/* Modern pill button for model selection */}
      <button
        type="button"
        disabled={running || !models.length}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'group inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all duration-150',
          'border border-black/[0.07] dark:border-white/[0.08] bg-white/75 dark:bg-zinc-900/75 backdrop-blur-md',
          'hover:bg-white dark:hover:bg-zinc-850 hover:border-black/[0.12] dark:hover:border-white/[0.15]',
          'text-zinc-800 dark:text-zinc-200 shadow-2xs active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
          open && 'border-accent-500/50 dark:border-accent-500/50 ring-2 ring-accent-500/15 bg-white dark:bg-zinc-800',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex h-4 w-4 items-center justify-center rounded-md bg-accent-500/10 text-accent-600 dark:text-accent-400">
          <Cpu size={12} />
        </div>
        <div className="flex items-center gap-1.5 truncate max-w-48 text-left">
          {currentModel ? (
            <>
              <span className="truncate font-semibold">{currentModel.displayName}</span>
              <span className="text-[10px] text-zinc-400 font-normal truncate hidden sm:inline">
                ({currentModel.providerName})
              </span>
            </>
          ) : (
            <span className="text-zinc-400">No models configured</span>
          )}
        </div>
        <ChevronDown
          size={12}
          className={cn('text-zinc-400 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {/* Popover list */}
      {open && (
        <div
          role="listbox"
          aria-label="Model"
          className="pop-in absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 p-1.5 shadow-xl shadow-zinc-950/15 backdrop-blur-md"
        >
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Select Model
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {models.map((m) => {
              const active = m.id === selectedModelId;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => void selectModel(m.id)}
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
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn('truncate text-xs font-medium', active && 'font-semibold text-accent-700 dark:text-accent-300')}>
                        {m.displayName}
                      </span>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200/60 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        {m.providerName}
                      </span>
                    </div>
                    {/* Capability badges */}
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                      {m.caps.thinking && (
                        <span className="flex items-center gap-0.5" title="Supports thinking / reasoning">
                          <Sparkles size={10} className="text-accent-500" /> Thinking
                        </span>
                      )}
                      {m.caps.image && (
                        <span className="flex items-center gap-0.5" title="Supports vision / image input">
                          <Eye size={10} /> Vision
                        </span>
                      )}
                      {m.caps.tools && (
                        <span className="flex items-center gap-0.5" title="Supports tool use">
                          <Wrench size={10} /> Tools
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Semantic hidden select for tests & accessibility */}
      <select
        value={selectedModelId}
        disabled={running}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void selectModel(e.target.value)}
        className="sr-only pointer-events-none"
      >
        {!models.length && <option value="">No models — add one in Settings</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.providerName} / {m.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
