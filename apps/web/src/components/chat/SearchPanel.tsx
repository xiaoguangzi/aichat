import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '@aichat/shared';
import { Loader2, Search, X } from 'lucide-react';
import { api } from '../../api/client';
import { useChat } from '../../store/chat';
import { useSettings } from '../../store/settings';
import { cn } from '../../lib/utils';

const DAY = 86_400_000;
const RANGES = [
  { label: '全部', days: 0 },
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
] as const;

const ROLES = [
  { label: '全部', value: '' },
  { label: '我的提问', value: 'user' },
  { label: '回答', value: 'assistant' },
] as const;

/**
 * Message-level search across every conversation. Unlike the sidebar box (which matches
 * conversations), this matches inside messages and jumps to the exact one, including hits that
 * currently sit on a superseded version.
 */
export function SearchPanel({ onClose, scope }: { onClose: () => void; scope?: { conversationId: string; title: string } }) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [days, setDays] = useState(0);
  // Defaults to the conversation the user opened it from, and can be widened to everything.
  const [everywhere, setEverywhere] = useState(!scope);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const select = useChat((s) => s.select);
  const requestJump = useChat((s) => s.requestJump);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    setBusy(true); setError('');
    try {
      setHits(await api.search.messages({
        q,
        ...(scope && !everywhere ? { conversationId: scope.conversationId } : {}),
        ...(role ? { role: role as 'user' | 'assistant' } : {}),
        ...(days ? { since: new Date(Date.now() - days * DAY).toISOString() } : {}),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [query, role, days, scope, everywhere]);

  /** Debounced so typing does not fire a query per keystroke. */
  useEffect(() => {
    const t = setTimeout(() => { void run(); }, 180);
    return () => clearTimeout(t);
  }, [run]);

  const grouped = useMemo(() => {
    const byConversation = new Map<string, { title: string; hits: SearchHit[] }>();
    for (const hit of hits ?? []) {
      const entry = byConversation.get(hit.conversationId);
      if (entry) entry.hits.push(hit);
      else byConversation.set(hit.conversationId, { title: hit.conversationTitle || '未命名对话', hits: [hit] });
    }
    return [...byConversation.entries()];
  }, [hits]);

  const open = async (hit: SearchHit) => {
    await select(hit.conversationId);
    requestJump(hit.messageId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 p-4 pt-[10vh] backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="搜索消息"
        className="card flex h-fit max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <Search size={14} className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            aria-label="搜索消息内容"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            placeholder={scope && !everywhere ? `在「${scope.title}」中搜索…` : '搜索所有对话的消息内容…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {busy && <Loader2 size={13} className="animate-spin text-zinc-400" />}
          <button type="button" aria-label="关闭搜索" title="关闭 (Esc)" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-3 py-2 text-[11px] dark:border-zinc-800">
          {scope && (
            <>
              <button
                type="button"
                onClick={() => setEverywhere((v) => !v)}
                className={cn('rounded-full px-2 py-0.5 transition-colors', everywhere ? 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'bg-accent-600 text-white')}
                title={everywhere ? '当前搜索全部对话' : `当前只搜索「${scope.title}」`}
              >
                {everywhere ? '全部对话' : '本对话'}
              </button>
              <span className="mx-1 h-3 w-px bg-zinc-200 dark:bg-zinc-700" />
            </>
          )}
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              className={cn('rounded-full px-2 py-0.5 transition-colors', role === r.value ? 'bg-accent-600 text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
            >
              {r.label}
            </button>
          ))}
          <span className="mx-1 h-3 w-px bg-zinc-200 dark:bg-zinc-700" />
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={cn('rounded-full px-2 py-0.5 transition-colors', days === r.days ? 'bg-accent-600 text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <p role="alert" className="px-2 py-3 text-xs text-red-600">{error}</p>}
          {!error && hits?.length === 0 && <p className="px-2 py-6 text-center text-xs text-zinc-500">没有匹配的消息。少于 3 个字符时按包含匹配，较长的查询走全文索引。</p>}
          {!error && hits === null && <p className="px-2 py-6 text-center text-xs text-zinc-400">输入关键词开始搜索。工具返回的正文也会被搜索到。</p>}
          {grouped.map(([conversationId, group]) => (
            <div key={conversationId} className="mb-2">
              <div className="px-2 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {group.title} · {group.hits.length} 条
              </div>
              {group.hits.map((hit) => (
                <button
                  key={hit.messageId}
                  type="button"
                  onClick={() => void open(hit)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span className={cn('rounded px-1 py-px', hit.role === 'user' ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300' : 'bg-zinc-100 dark:bg-zinc-800')}>
                      {hit.role === 'user' ? '我' : 'AI'}
                    </span>
                    <span>{new Date(hit.createdAt).toLocaleString()}</span>
                    {!hit.visible && <span className="text-amber-600" title="这条消息属于另一个版本，跳转后会看到当前选中的版本">旧版本</span>}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-700 dark:text-zinc-300">{hit.snippet}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
