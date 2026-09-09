import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  Search,
  Settings,
  Pencil,
  Trash2,
  X,
  FolderPlus,
  ChevronRight,
  Check,
  GripVertical,
  FolderInput,
  PanelLeftClose,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Conversation, ConversationGroup } from '@aichat/shared';
import { useChat } from '../../store/chat';
import { api } from '../../api/client';
import { cn, formatTime } from '../../lib/utils';
import { LogoMark } from '../ui/Logo';
import { ThemePicker } from './ThemePicker.js';
import { GroupMenu } from './GroupMenu';

/** Custom drag MIME types keep conversation drags and group-reorder drags apart. */
const CONV_MIME = 'application/x-aichat-conversation';
const GROUP_MIME = 'application/x-aichat-group';
/** drop-target key for the "no group" section */
const UNGROUPED = '__ungrouped__';

export function ConversationList({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const conversations = useChat((s) => s.conversations);
  const groups = useChat((s) => s.groups);
  const currentId = useChat((s) => s.current?.id);
  const loadConversations = useChat((s) => s.loadConversations);
  const loadGroups = useChat((s) => s.loadGroups);
  const createGroup = useChat((s) => s.createGroup);
  const reorderGroups = useChat((s) => s.reorderGroups);
  const moveConversation = useChat((s) => s.moveConversation);
  const newDraft = useChat((s) => s.newDraft);
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const activeId = routeId ?? currentId;
  const searching = q.trim().length > 0;

  useEffect(() => { onClose?.(); }, [routeId]);

  useEffect(() => {
    const t = setTimeout(() => void loadConversations(q), 200);
    return () => clearTimeout(t);
  }, [q, loadConversations]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const byGroup = useMemo(() => {
    const m = new Map<string, Conversation[]>();
    for (const c of conversations) {
      const key = c.groupId ?? UNGROUPED;
      const list = m.get(key);
      if (list) list.push(c);
      else m.set(key, [c]);
    }
    return m;
  }, [conversations]);
  const ungrouped = byGroup.get(UNGROUPED) ?? [];

  const onDropConversation = (e: React.DragEvent, groupId: string | null) => {
    const id = e.dataTransfer.getData(CONV_MIME) || e.dataTransfer.getData('text/plain');
    setDropTarget(null);
    if (!id) return;
    e.preventDefault();
    void moveConversation(id, groupId);
  };

  const submitNewGroup = async () => {
    const name = (newGroupName ?? '').trim();
    setNewGroupName(null);
    if (name) await createGroup(name);
  };

  return (
    <aside className={cn("chat-sidebar flex h-full w-72 shrink-0 flex-col border-r backdrop-blur-md", mobileOpen && "is-open")}>
      {/* Brand header */}
      <div className="sidebar-brand flex items-center gap-3 px-5 pb-5 pt-6">
        <LogoMark size="lg" />
        <div className="flex-1 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="text-xl">aichat</span>
          <p className="mt-0.5 text-[11px] font-normal text-zinc-400">更好的思考，更简单的生活</p>
        </div>
        <button type="button" className="mobile-sidebar-toggle" aria-label="收起侧栏" onClick={onClose}><PanelLeftClose size={18} /></button>
      </div>

      {/* New chat / new group */}
      <div className="flex items-center gap-1.5 px-3 pb-2.5">
        <button
          type="button"
          onClick={() => { newDraft(); nav('/'); onClose?.(); }}
          className="new-chat-button flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all active:scale-[0.99]"
        >
          <MessageSquarePlus size={16} />
          <span>新建对话</span><span className="sr-only">New chat</span>
        </button>
        <button
          type="button"
          onClick={() => setNewGroupName('')}
          title="New group"
          className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-white/80 dark:bg-zinc-800/80 border border-black/[0.08] dark:border-white/[0.08] text-zinc-600 dark:text-zinc-300 shadow-2xs transition-all hover:bg-white dark:hover:bg-zinc-750 hover:text-zinc-900 dark:hover:text-white active:scale-[0.97]"
        >
          <FolderPlus size={16} />
        </button>
      </div>

      {/* Search box (all conversations) */}
      <div className="px-3 pb-2.5">
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.025] dark:bg-white/[0.04] px-2.5 py-1.5 text-xs transition-colors focus-within:bg-white dark:focus-within:bg-zinc-900 focus-within:border-accent-500/50 focus-within:ring-2 focus-within:ring-accent-500/15">
          <Search size={13} className="shrink-0 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索对话…"
            className="w-full bg-transparent text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-section-label">对话与分组</div>
      {/* Groups + conversation history */}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {newGroupName !== null && (
          <div className="mb-1 flex items-center gap-1 rounded-xl border border-accent-500/40 bg-white dark:bg-zinc-900 px-2 py-1.5">
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewGroup();
                if (e.key === 'Escape') setNewGroupName(null);
              }}
              onBlur={() => void submitNewGroup()}
              placeholder="Group name…"
              className="w-full bg-transparent text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
            />
            <Check size={13} className="shrink-0 text-accent-500" />
          </div>
        )}

        {groups.map((g, i) => (
          <GroupSection
            key={g.id}
            group={g}
            conversations={byGroup.get(g.id) ?? []}
            searching={searching}
            activeId={activeId}
            isDropTarget={dropTarget === g.id}
            onDragOverGroup={() => setDropTarget(g.id)}
            onDragLeaveGroup={() => setDropTarget((t) => (t === g.id ? null : t))}
            onDropConversation={(e) => onDropConversation(e, g.id)}
            onDropGroup={(e) => {
              const dragged = e.dataTransfer.getData(GROUP_MIME);
              setDropTarget(null);
              if (!dragged || dragged === g.id) return;
              e.preventDefault();
              const ids = groups.map((x) => x.id).filter((x) => x !== dragged);
              ids.splice(Math.min(i, ids.length), 0, dragged);
              void reorderGroups(ids);
            }}
          />
        ))}

        {/* Ungrouped conversations — also the drop zone for pulling one out of a group */}
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(CONV_MIME)) return;
            e.preventDefault();
            setDropTarget(UNGROUPED);
          }}
          onDragLeave={() => setDropTarget((t) => (t === UNGROUPED ? null : t))}
          onDrop={(e) => onDropConversation(e, null)}
          className={cn(
            'mt-1 rounded-xl border border-transparent p-0.5 transition-colors',
            dropTarget === UNGROUPED && 'border-dashed border-accent-500/60 bg-accent-500/5',
          )}
        >
          {groups.length > 0 && (
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Ungrouped
            </div>
          )}
          <div className="space-y-0.5">
            {ungrouped.map((c) => (
              <ConversationRow key={c.id} conv={c} active={c.id === activeId} />
            ))}
          </div>
          {ungrouped.length === 0 && groups.length > 0 && (
            <div className="px-2 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {searching ? 'No matches here' : 'Drag a chat here to remove it from its group'}
            </div>
          )}
        </div>

        {conversations.length === 0 && groups.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {searching ? 'No matching conversations' : 'No conversations yet'}
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-avatar">G</div>
        <div className="min-w-0 flex-1"><p>我的空间</p><span>保持好奇，继续探索</span></div>
        <Link to="/settings/providers" title="Settings" aria-label="设置"><Settings size={17} /></Link>
        <ThemePicker />
      </div>
    </aside>
  );
}

interface GroupSectionProps {
  group: ConversationGroup;
  conversations: Conversation[];
  searching: boolean;
  activeId: string | undefined;
  isDropTarget: boolean;
  onDragOverGroup: () => void;
  onDragLeaveGroup: () => void;
  onDropConversation: (e: React.DragEvent) => void;
  onDropGroup: (e: React.DragEvent) => void;
}

function GroupSection({
  group,
  conversations,
  searching,
  activeId,
  isDropTarget,
  onDragOverGroup,
  onDragLeaveGroup,
  onDropConversation,
  onDropGroup,
}: GroupSectionProps) {
  const setGroupCollapsed = useChat((s) => s.setGroupCollapsed);
  const renameGroup = useChat((s) => s.renameGroup);
  const deleteGroup = useChat((s) => s.deleteGroup);
  const newDraft = useChat((s) => s.newDraft);
  const nav = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [gq, setGq] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<Conversation[] | null>(null);
  const inGroupQuery = gq.trim();
  // in-group search hits message text too, so it goes to the server rather than filtering locally
  const membership = conversations.map((c) => c.id).join(',');
  useEffect(() => {
    if (!inGroupQuery) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.conversations
        .list({ q: inGroupQuery, groupId: group.id })
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [inGroupQuery, group.id, membership]);

  // a search (here or in the sidebar) always shows what it found, collapsed or not
  const expanded = !group.collapsed || searching || !!inGroupQuery;
  const shown = results ?? conversations;

  const submitName = async () => {
    const next = (name ?? '').trim();
    setName(null);
    if (next && next !== group.name) await renameGroup(group.id, next);
  };

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(CONV_MIME) || e.dataTransfer.types.includes(GROUP_MIME)) {
          e.preventDefault();
          onDragOverGroup();
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragLeaveGroup();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes(GROUP_MIME)) onDropGroup(e);
        else onDropConversation(e);
      }}
      className={cn(
        'rounded-xl border border-transparent transition-colors',
        isDropTarget && 'border-dashed border-accent-500/60 bg-accent-500/5',
      )}
    >
      {/* Group header */}
      <div
        draggable={name === null}
        onDragStart={(e) => {
          e.dataTransfer.setData(GROUP_MIME, group.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className="group/h flex items-center gap-1 rounded-xl px-1.5 py-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-850/60"
      >
        <GripVertical size={12} className="shrink-0 cursor-grab text-zinc-300 dark:text-zinc-700 opacity-0 group-hover/h:opacity-100" />
        <button
          type="button"
          onClick={() => void setGroupCollapsed(group.id, !group.collapsed)}
          className="shrink-0 rounded-md p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={13} className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        {name === null ? (
          <button
            type="button"
            onClick={() => void setGroupCollapsed(group.id, !group.collapsed)}
            title={group.name}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-zinc-700 dark:text-zinc-200"
          >
            {group.name}
            <span className="ml-1.5 font-normal text-[10px] text-zinc-400">{conversations.length}</span>
          </button>
        ) : (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitName();
              if (e.key === 'Escape') setName(null);
            }}
            onBlur={() => void submitName()}
            className="min-w-0 flex-1 rounded-md border border-accent-500/50 bg-white dark:bg-zinc-900 px-1 py-0.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none"
          />
        )}
        <div className={cn('flex items-center gap-0.5', name === null ? 'opacity-0 group-hover/h:opacity-100' : 'hidden')}>
          <button
            type="button"
            title="Search in this group"
            onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setGq(''); }}
            className={cn(
              'rounded-md p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200',
              (searchOpen || inGroupQuery) && 'text-accent-600 dark:text-accent-400 opacity-100',
            )}
          >
            <Search size={12} />
          </button>
          <button
            type="button"
            title="New chat in this group"
            onClick={() => { newDraft(group.id); nav('/'); }}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <MessageSquarePlus size={12} />
          </button>
          <button
            type="button"
            title="Rename group"
            onClick={() => setName(group.name)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            title="Delete group (chats are kept)"
            onClick={() => {
              if (confirm(`Delete group "${group.name}"? Its conversations are kept and become ungrouped.`)) void deleteGroup(group.id);
            }}
            className="rounded-md p-1 text-zinc-400 hover:bg-red-100 dark:hover:bg-red-950/60 hover:text-red-600"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* In-group search box */}
      {(searchOpen || inGroupQuery) && (
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200/70 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 px-2 py-1 text-[11px] focus-within:border-accent-500/50">
            <Search size={11} className="shrink-0 text-zinc-400" />
            <input
              autoFocus
              value={gq}
              onChange={(e) => setGq(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setGq(''); setSearchOpen(false); } }}
              placeholder={`Search in ${group.name}…`}
              className="w-full bg-transparent text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
            />
            {gq && (
              <button type="button" onClick={() => setGq('')} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-0.5 pb-1 pl-2">
          {shown.map((c) => (
            <ConversationRow key={c.id} conv={c} active={c.id === activeId} />
          ))}
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {inGroupQuery || searching ? 'No matches in this group' : 'Empty — drag conversations here'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationRow({ conv, active }: { conv: Conversation; active: boolean }) {
  const deleteConversation = useChat((s) => s.deleteConversation);
  const updateConversation = useChat((s) => s.updateConversation);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CONV_MIME, conv.id);
        e.dataTransfer.setData('text/plain', conv.id);
        e.dataTransfer.effectAllowed = 'move';
        ref.current?.classList.add('opacity-50');
      }}
      onDragEnd={() => ref.current?.classList.remove('opacity-50')}
      onClick={() => nav(`/c/${conv.id}`)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuAt(new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
      className={cn(
        'group relative flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm transition-all duration-150',
        active
          ? 'bg-white/90 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 shadow-2xs border border-black/[0.06] dark:border-white/[0.08] font-medium'
          : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.035] dark:hover:bg-white/[0.05] border border-transparent',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs leading-5">{conv.title || 'New chat'}</div>
        <div className="text-[10px] text-zinc-400 font-normal">{formatTime(conv.updatedAt)}</div>
      </div>
      <div className={cn('items-center gap-0.5 group-hover:flex', menuAt ? 'flex' : 'hidden')}>
        <button
          type="button"
          className={cn(
            'rounded-md p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200',
            menuAt && 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200',
          )}
          title="Move to group (or right-click the chat)"
          data-group-menu-anchor
          onClick={(e) => {
            e.stopPropagation();
            setMenuAt(menuAt ? null : e.currentTarget.getBoundingClientRect());
          }}
        >
          <FolderInput size={12} />
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            const t = prompt('Rename conversation', conv.title);
            if (t != null && t.trim()) void updateConversation(conv.id, { title: t.trim() });
          }}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-zinc-400 hover:bg-red-100 dark:hover:bg-red-950/60 hover:text-red-600"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this conversation?')) void deleteConversation(conv.id);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {menuAt && (
        <GroupMenu conversationId={conv.id} groupId={conv.groupId} anchor={menuAt} onClose={() => setMenuAt(null)} />
      )}
    </div>
  );
}
