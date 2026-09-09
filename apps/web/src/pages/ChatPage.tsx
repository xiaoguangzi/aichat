import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Download, X, Folder, FolderInput, PanelLeft } from 'lucide-react';
import { useChat } from '../store/chat';
import { useSettings } from '../store/settings';
import { ConversationList } from '../components/chat/ConversationList';
import { MessageList } from '../components/chat/MessageList';
import { QuoteSelection } from '../components/chat/QuoteSelection.js';
import { Composer } from '../components/chat/Composer';
import { ModelPicker } from '../components/chat/ModelPicker';
import { ApprovalBanner } from '../components/chat/ApprovalBanner';
import { ConversationSettingsPanel } from '../components/chat/ConversationSettings';
import { GroupMenu } from '../components/chat/GroupMenu';
import { ArtifactWorkspace, useArtifacts } from '../components/artifacts/ArtifactWorkspace.js';
import { api } from '../api/client';
import { Welcome, StarterCards } from '../components/chat/Welcome.js';
import { cn } from '../lib/utils';

export function ChatPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const current = useChat((s) => s.current);
  const select = useChat((s) => s.select);
  const newDraft = useChat((s) => s.newDraft);
  const error = useChat((s) => s.error);
  const clearError = useChat((s) => s.clearError);
  const groups = useChat((s) => s.groups);
  const loadAll = useSettings((s) => s.loadAll);
  const [quote, setQuote] = useState<{ text: string; conversationId: string | undefined } | null>(null);
  const messages = useChat((s) => s.messages);
  const [starter, setStarter] = useState<{ text: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const landing = !current && messages.length === 0;
  const [showSettings, setShowSettings] = useState(false);
  const [groupMenuAt, setGroupMenuAt] = useState<DOMRect | null>(null);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [sidebarOpen]);

  // Single source of truth for route <-> store sync. The two directions must not fire for the
  // same change, and the trigger has to be the route id *changing* rather than merely differing
  // from the store: react-router defers navigation, so clearing to a draft ("New chat") commits
  // `current = null` one render before the URL becomes `/`. Keying off the difference alone made
  // that intermediate frame look like "route points at a conversation we are not showing" and
  // re-selected the conversation the user just left.
  // starts undefined so the very first route id counts as a change and gets selected
  const lastRouteId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (id !== lastRouteId.current) {
      lastRouteId.current = id;
      // a deleted or bogus id lands on a clean draft rather than leaving the previous
      // conversation on screen under a `/` url
      if (id && id !== current?.id) void select(id).catch(() => { newDraft(); nav('/', { replace: true }); });
      return;
    }
    // route held still and the store moved — follow it
    if (!id && current) nav(`/c/${current.id}`, { replace: true });
  }, [id, current?.id, select, newDraft, nav]);

  const currentGroup = groups.find((g) => g.id === current?.groupId) ?? null;
  const iconBtn = 'rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-200/70 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40';

  return (
    <div className="chat-shell flex h-full overflow-hidden">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />}
      <ConversationList mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1">
      <ArtifactWorkspace key={current?.id ?? "draft"} conversationId={current?.id}>
      <main className={cn("chat-main flex min-w-0 flex-1 flex-col", landing && "is-landing")}>
        <header className="chat-header glass-header flex flex-wrap items-center gap-2 px-5 py-2.5">
          <button type="button" className="mobile-sidebar-toggle" aria-label="打开侧栏" onClick={() => setSidebarOpen(true)}><PanelLeft size={19} /></button>
          <div className="header-title min-w-28 flex-1 truncate text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
            {current?.title || <span className="header-greeting">你的日常灵感空间</span>}
          </div>
          {current && (
            <button
              type="button"
              data-group-menu-anchor
              onClick={(e) => setGroupMenuAt(groupMenuAt ? null : e.currentTarget.getBoundingClientRect())}
              title={currentGroup ? `In group “${currentGroup.name}” — click to change` : 'Add this chat to a group'}
              className={cn(
                'chat-group-button flex max-w-40 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors',
                currentGroup
                  ? 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800/70 hover:bg-zinc-200/80 dark:hover:bg-zinc-800'
                  : 'text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200',
              )}
            >
              {currentGroup ? <Folder size={13} className="shrink-0" /> : <FolderInput size={13} className="shrink-0" />}
              <span className="truncate">{currentGroup ? currentGroup.name : 'Add to group'}</span>
            </button>
          )}
          {current && groupMenuAt && (
            <GroupMenu
              conversationId={current.id}
              groupId={current.groupId}
              anchor={groupMenuAt}
              onClose={() => setGroupMenuAt(null)}
            />
          )}
          <ArtifactPicker />
          <div className="header-model"><ModelPicker /></div>
          {current && (
            <a
              href={api.conversations.exportUrl(current.id)}
              download
              className={iconBtn}
              title="Export Markdown"
            >
              <Download size={15} />
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              iconBtn,
              showSettings && 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200',
            )}
            title="Conversation settings"
          >
            <SlidersHorizontal size={15} />
          </button>
        </header>
        {error && (
          <div className="fade-in flex items-center gap-2 border-b border-red-200/60 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/50"><X size={14} /></button>
          </div>
        )}
        <div className={cn("chat-body", landing && "landing-body")}>
        {landing && <Welcome />}
        {!landing && <QuoteSelection key={current?.id ?? "draft"} onQuote={(text) => setQuote({ text, conversationId: current?.id })}>
          <MessageList />
        </QuoteSelection>}
        <div className="px-4"><ApprovalBanner /></div>
        <Composer quote={quote} starter={starter} />
        {landing && <StarterCards onPick={(text) => setStarter({ text })} />}
        </div>
      </main>
      </ArtifactWorkspace>
      {showSettings && <ConversationSettingsPanel onClose={() => setShowSettings(false)} />}
      </div>
    </div>
  );
}

function ArtifactPicker() {
  const { versions, open } = useArtifacts();
  const latest = [...new Map(versions.map(a => [a.id, a])).values()];
  if (!latest.length) return null;
  return <select aria-label="打开作品" value="" onChange={e => open(e.target.value)} className="max-w-32 rounded-lg bg-transparent p-1.5 text-xs text-zinc-500">
    <option value="" disabled>Artifacts ({latest.length})</option>
    {latest.map(a => <option key={a.id} value={a.key}>{a.title}</option>)}
  </select>;
}
