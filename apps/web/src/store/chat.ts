import { create } from 'zustand';
import type { Block, ChatSSEEvent, Conversation, ConversationGroup, ConversationInput, ConversationSettings, Message, ReasoningLevel, ToolResultBlock } from '@aichat/shared';
import { api, ApiError } from '../api/client.js';
import { defaultReasoning, rememberReasoning } from '../lib/reasoning';
import { resumeChat, streamChat } from '../api/sse.js';

export interface Approval {
  requestId: string;
  tool: string;
  input: unknown;
}

interface ChatState {
  conversations: Conversation[];
  groups: ConversationGroup[];
  query: string;
  current: Conversation | null;
  draftReasoning: ReasoningLevel | null;
  draftModelId: string | null;
  /** group a not-yet-saved chat will be created in ("New chat" inside a group header) */
  draftGroupId: string | null;
  draftSystemPrompt: string;
  draftSettings: ConversationSettings;
  messages: Message[];
  /** message being streamed (not yet persisted) */
  streaming: Message | null;
  running: boolean;
  pendingResults: Record<string, ToolResultBlock>;
  approval: Approval | null;
  error: string | null;
  abort: AbortController | null;

  setDraftReasoning: (level: ReasoningLevel) => void;
  setDraftModelId: (modelId: string | null) => void;
  setDraftGroupId: (groupId: string | null) => void;
  setDraftSystemPrompt: (prompt: string) => void;
  setDraftSettings: (settings: ConversationSettings) => void;
  loadConversations: (q?: string) => Promise<void>;
  loadGroups: () => Promise<void>;
  createGroup: (name: string) => Promise<ConversationGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  setGroupCollapsed: (id: string, collapsed: boolean) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  reorderGroups: (ids: string[]) => Promise<void>;
  /** drag & drop target: null moves the conversation out of every group */
  moveConversation: (id: string, groupId: string | null) => Promise<void>;
  select: (id: string | null) => Promise<void>;
  /** clear to an unsaved draft chat (no network round trip) */
  newDraft: (groupId?: string | null) => void;
  createConversation: (input?: ConversationInput) => Promise<Conversation>;
  updateConversation: (id: string, input: ConversationInput) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  send: (text: string, attachmentIds?: string[]) => Promise<void>;
  regenerate: () => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  stop: () => Promise<void>;
  resolveApproval: (ok: boolean) => Promise<void>;
  clearError: () => void;
}

/** guards against out-of-order conversation fetches when switching quickly */
let selectSeq = 0;

type RunView = Pick<ChatState, 'messages' | 'streaming' | 'running' | 'pendingResults' | 'approval' | 'error' | 'abort'>;
type ActiveRun = RunView & { conversation: Conversation };
const idleView = (): Omit<RunView, 'messages'> => ({
  streaming: null, running: false, pendingResults: {}, approval: null, error: null, abort: null,
});

// A page only displays a run; navigating away must not own or clear its lifetime.
const runs = new Map<string, ActiveRun>();
const runView = ({ conversation: _conversation, ...view }: ActiveRun): RunView => ({
  ...view,
  streaming: view.streaming ? { ...view.streaming, content: view.streaming.content.map((b) => ({ ...b })) } : null,
});

/** last-seen messages per conversation, so re-opening one paints in the same frame as the click */
const msgCache = new Map<string, Message[]>();
const MSG_CACHE_MAX = 30;
const cacheMessages = (id: string, messages: Message[]) => {
  msgCache.delete(id);
  msgCache.set(id, messages);
  while (msgCache.size > MSG_CACHE_MAX) msgCache.delete(msgCache.keys().next().value!);
};
/** message rows are immutable once persisted, so identity by id list is enough */
const sameMessages = (a: Message[], b: Message[]) => a.length === b.length && a.every((m, i) => m.id === b[i]!.id);

export const useChat = create<ChatState>((set, get) => {
  const run = async (convId: string, input?: Parameters<typeof streamChat>[1]) => {
    const ac = new AbortController();
    const state: ActiveRun = {
      ...idleView(), conversation: get().current!, messages: get().messages,
      running: true, abort: ac,
    };
    runs.set(convId, state);
    cacheMessages(convId, state.messages);
    const publish = (patch: Partial<RunView> = {}) => {
      Object.assign(state, patch);
      if (runs.get(convId) === state && get().current?.id === convId) set(runView(state));
    };
    let pendingStreaming: Message | null = null;
    let flushTimer: number | null = null;
    const scheduleFlush = () => {
      if (flushTimer != null) return;
      flushTimer = window.requestAnimationFrame(() => {
        flushTimer = null;
        if (pendingStreaming) publish();
      });
    };
    publish();
    const handle = (ev: ChatSSEEvent) => {
      const s = get();
      switch (ev.event) {
        case 'snapshot': {
          if (flushTimer != null) window.cancelAnimationFrame(flushTimer);
          flushTimer = null;
          const { conversation, ...view } = structuredClone(ev.data);
          if (conversation.id !== convId) break;
          state.conversation = conversation;
          pendingStreaming = view.streaming;
          publish(view);
          cacheMessages(convId, view.messages);
          if (get().current?.id === convId) set({ current: conversation });
          break;
        }
        case 'approval_state':
          publish({ approval: ev.data.approval });
          break;
        case 'message_start':
          pendingStreaming = { id: ev.data.messageId, conversationId: convId, seq: 0, role: ev.data.role, content: [], createdAt: new Date().toISOString() };
          publish({ streaming: pendingStreaming });
          break;
        case 'text_delta': {
          if (!pendingStreaming) break;
          const last = pendingStreaming.content[pendingStreaming.content.length - 1];
          if (last && last.type === 'text') last.text += ev.data.text;
          else pendingStreaming.content.push({ type: 'text', text: ev.data.text });
          scheduleFlush();
          break;
        }
        case 'thinking_delta': {
          if (!pendingStreaming) break;
          const last = pendingStreaming.content[pendingStreaming.content.length - 1];
          if (last && last.type === 'thinking') last.thinking += ev.data.text;
          else pendingStreaming.content.push({ type: 'thinking', thinking: ev.data.text });
          scheduleFlush();
          break;
        }
        case 'thinking_reclassify': {
          // a </think> the model leaked into its answer: what streamed as text was reasoning
          if (!pendingStreaming) break;
          const next: Block[] = [];
          for (const b of pendingStreaming.content) {
            const nb: Block = b.type === 'text' ? { type: 'thinking', thinking: b.text } : b;
            const last = next[next.length - 1];
            if (nb.type === 'thinking' && last && last.type === 'thinking') last.thinking += nb.thinking;
            else next.push(nb);
          }
          pendingStreaming.content = next;
          scheduleFlush();
          break;
        }
        case 'tool_call_start':
          if (!pendingStreaming) break;
          pendingStreaming.content.push({ type: 'tool_use', id: ev.data.id, name: ev.data.name, input: null });
          scheduleFlush();
          break;
        case 'tool_call': {
          if (!pendingStreaming) break;
          const b = pendingStreaming.content.find((x): x is Extract<Block, { type: 'tool_use' }> => x.type === 'tool_use' && x.id === ev.data.id);
          if (b) b.input = ev.data.input;
          else pendingStreaming.content.push({ type: 'tool_use', id: ev.data.id, name: ev.data.name, input: ev.data.input });
          scheduleFlush();
          break;
        }
        case 'tool_result':
          publish({
            pendingResults: {
              ...state.pendingResults,
              [ev.data.toolUseId]: { type: 'tool_result', tool_use_id: ev.data.toolUseId, content: ev.data.content, is_error: ev.data.isError, durationMs: ev.data.durationMs },
            },
          });
          break;
        case 'approval_required':
          publish({ approval: ev.data });
          break;
        case 'usage':
          if (pendingStreaming) { pendingStreaming.usage = ev.data; scheduleFlush(); }
          break;
        case 'message_end':
          pendingStreaming = null;
          publish({ messages: [...state.messages.filter((m) => m.id !== ev.data.messageId), ev.data.message], streaming: null, approval: null });
          cacheMessages(convId, state.messages);
          break;
        case 'title':
          state.conversation = { ...state.conversation, title: ev.data.title };
          set({
            conversations: s.conversations.map((c) => (c.id === ev.data.conversationId ? { ...c, title: ev.data.title } : c)),
            current: s.current?.id === ev.data.conversationId ? { ...s.current, title: ev.data.title } : s.current,
          });
          break;
        case 'error':
          publish({ error: ev.data.message });
          break;
        case 'done':
          break;
      }
    };
    try {
      if (input) await streamChat(convId, input, handle, ac.signal);
      else await resumeChat(convId, handle, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) publish({ error: e instanceof Error ? e.message : 'Failed to send message' });
    } finally {
      if (flushTimer != null) window.cancelAnimationFrame(flushTimer);
      pendingStreaming = null;
      publish({ running: false, abort: null, streaming: null, approval: null });
      // Refresh the owning conversation even when it finished offscreen. Never let
      // an older run's refresh replace a newer reply or another conversation's view.
      try {
        const { messages, running: _running, ...conv } = await api.conversations.get(convId);
        if (runs.get(convId) === state) {
          state.conversation = conv;
          cacheMessages(convId, messages);
          publish({ messages, pendingResults: {} });
          if (get().current?.id === convId) set({ current: conv });
        }
      } catch {
        // Keep the messages already received through SSE when a refresh fails.
      }
      if (runs.get(convId) === state) runs.delete(convId);
      void get().loadConversations(get().query).catch(() => {});
    }
  };

  return {
    conversations: [],
    groups: [],
    query: '',
    current: null,
    draftReasoning: defaultReasoning(),
    draftModelId: null,
    draftGroupId: null,
    draftSystemPrompt: '',
    draftSettings: {},
    messages: [],
    streaming: null,
    running: false,
    pendingResults: {},
    approval: null,
    error: null,
    abort: null,

    setDraftReasoning: (level: ReasoningLevel) => {
      rememberReasoning(level);
      set({ draftReasoning: level });
    },
    setDraftModelId: (modelId: string | null) => {
      set({ draftModelId: modelId });
    },
    setDraftGroupId: (groupId: string | null) => {
      set({ draftGroupId: groupId });
    },
    setDraftSystemPrompt: (prompt: string) => {
      set({ draftSystemPrompt: prompt });
    },
    setDraftSettings: (settings: ConversationSettings) => {
      set({ draftSettings: settings });
    },

    loadConversations: async (q) => {
      set({ query: q ?? '' });
      set({ conversations: await api.conversations.list({ q }) });
    },
    loadGroups: async () => {
      set({ groups: await api.groups.list() });
    },
    createGroup: async (name) => {
      const g = await api.groups.create({ name });
      set({ groups: [...get().groups, g] });
      return g;
    },
    renameGroup: async (id, name) => {
      const g = await api.groups.update(id, { name });
      set({ groups: get().groups.map((x) => (x.id === id ? g : x)) });
    },
    setGroupCollapsed: async (id, collapsed) => {
      // optimistic: the disclosure triangle must not wait for the round trip
      set({ groups: get().groups.map((x) => (x.id === id ? { ...x, collapsed } : x)) });
      await api.groups.update(id, { collapsed }).catch(() => {});
    },
    deleteGroup: async (id) => {
      await api.groups.remove(id);
      set({
        groups: get().groups.filter((g) => g.id !== id),
        // the server ungroups them rather than deleting them
        conversations: get().conversations.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)),
        current: get().current?.groupId === id ? { ...get().current!, groupId: null } : get().current,
      });
    },
    reorderGroups: async (ids) => {
      const byId = new Map(get().groups.map((g) => [g.id, g]));
      const next = ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
      set({ groups: next.map((g, i) => ({ ...g, sortOrder: i })) });
      set({ groups: await api.groups.reorder(ids) });
    },
    moveConversation: async (id, groupId) => {
      const before = get().conversations;
      const known = before.find((c) => c.id === id);
      if (known && known.groupId === groupId) return;
      set({
        conversations: before.map((c) => (c.id === id ? { ...c, groupId } : c)),
        current: get().current?.id === id ? { ...get().current!, groupId } : get().current,
      });
      try {
        await api.conversations.update(id, { groupId });
      } catch (e) {
        set({ conversations: before, error: e instanceof Error ? e.message : 'Failed to move conversation' });
      }
    },
    select: async (id) => {
      const seq = ++selectSeq;
      if (!id) {
        get().newDraft();
        return;
      }
      if (get().current?.id === id) return;
      // paint the target conversation immediately when we already know it: the header, the
      // sidebar highlight and the message list all swap in the frame the click lands in,
      // instead of leaving the previous conversation on screen until the fetch resolves.
      const known = get().conversations.find((c) => c.id === id);
      const active = runs.get(id);
      if (active) {
        set({ current: known ?? active.conversation, ...runView(active) });
        return;
      }
      const cached = msgCache.get(id);
      if (known && cached) set({ current: known, messages: cached, ...idleView() });
      let full: Conversation & { messages: Message[]; running?: boolean };
      try {
        full = await api.conversations.get(id);
      } catch (e) {
        if (seq !== selectSeq || runs.has(id)) return;
        // A failed revalidation must not make ChatPage discard a cached reply.
        if (known && cached && !(e instanceof ApiError && e.status === 404)) {
          if (get().current?.id === id) set({ error: e instanceof Error ? e.message : 'Failed to refresh conversation' });
          return;
        }
        throw e;
      }
      // a newer selection (or clearing) happened while we were fetching — drop this one
      if (seq !== selectSeq) return;
      const { messages: fetchedMessages, running: serverRunning, ...conv } = full;
      const live = runs.get(id);
      if (live) {
        set({ current: get().conversations.find((c) => c.id === id) ?? live.conversation, ...runView(live) });
        return;
      }
      // A run may have started AND finished while this request was in flight.
      const latest = msgCache.get(id);
      const messages = latest && latest !== cached ? latest : fetchedMessages;
      cacheMessages(id, messages);
      const s = get();
      // already showing exactly this — avoid a second commit that would re-render every message
      if (s.current?.id === id && sameMessages(s.messages, messages)) {
        if (JSON.stringify(s.current) !== JSON.stringify(conv)) set({ current: conv });
        if (serverRunning) void run(id);
        return;
      }
      set({ current: conv, messages, ...idleView() });
      if (serverRunning) void run(id);
    },
    newDraft: (groupId) => {
      // invalidate any in-flight select so it cannot resurrect the conversation we just left
      selectSeq++;
      set({
        current: null,
        draftReasoning: defaultReasoning(),
        draftModelId: null,
        draftGroupId: groupId ?? null,
        draftSystemPrompt: '',
        draftSettings: {},
        messages: [],
        ...idleView(),
      });
    },
    createConversation: async (input) => {
      selectSeq++;
      // Every conversation carries a concrete effort from the start (the last one picked in the
      // composer), so the level shown there is the level actually sent.
      const state = get();
      const reasoning = input?.settings?.reasoning ?? state.draftReasoning ?? defaultReasoning();
      const settings = {
        reasoning,
        ...(state.draftSettings ?? {}),
        ...(input?.settings ?? {}),
      };
      const modelId = input?.modelId ?? state.draftModelId ?? undefined;
      const groupId = input?.groupId ?? state.draftGroupId ?? undefined;
      const systemPrompt = input?.systemPrompt ?? (state.draftSystemPrompt || undefined);
      const conv = await api.conversations.create({ ...input, modelId, groupId, systemPrompt, settings });
      selectSeq++;
      cacheMessages(conv.id, []);
      set({ conversations: [conv, ...get().conversations], current: conv, messages: [], ...idleView() });
      return conv;
    },
    updateConversation: async (id, input) => {
      const conv = await api.conversations.update(id, input);
      set({ current: get().current?.id === id ? conv : get().current, conversations: get().conversations.map((c) => (c.id === id ? conv : c)) });
    },
    deleteConversation: async (id) => {
      await api.conversations.remove(id);
      msgCache.delete(id);
      set({ conversations: get().conversations.filter((c) => c.id !== id) });
      if (get().current?.id === id) get().newDraft();
    },
    send: async (text, attachmentIds) => {
      let conv = get().current;
      if (!conv) conv = await get().createConversation();
      if (runs.get(conv.id)?.running) return;
      const attBlocks: Block[] = (attachmentIds ?? []).map((id) => ({ type: 'document', mime: '', name: '', attachmentId: id }));
      const optimistic: Message = {
        id: `tmp_${Date.now()}`,
        conversationId: conv.id,
        seq: 0,
        role: 'user',
        content: [...attBlocks, { type: 'text', text }],
        createdAt: new Date().toISOString(),
      };
      set({ messages: [...get().messages, optimistic] });
      await run(conv.id, { text, attachmentIds });
    },
    regenerate: async () => {
      const conv = get().current;
      if (!conv || runs.get(conv.id)?.running) return;
      const msgs = get().messages;
      let i = msgs.length - 1;
      while (i >= 0 && !(msgs[i]!.role === 'user' && msgs[i]!.content.some((b) => b.type !== 'tool_result'))) i--;
      if (i < 0) return;
      set({ messages: msgs.slice(0, i + 1), pendingResults: {} });
      await run(conv.id, { text: '', regenerate: true });
    },
    editAndResend: async (messageId, text) => {
      const conv = get().current;
      if (!conv || runs.get(conv.id)?.running) return;
      const msgs = get().messages;
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const kept = msgs.slice(0, idx);
      const edited: Message = { ...msgs[idx]!, content: [...msgs[idx]!.content.filter((b) => b.type !== 'text'), { type: 'text', text }] };
      set({ messages: [...kept, edited], pendingResults: {} });
      const attachmentIds = msgs[idx]!.content.flatMap((b) => ((b.type === 'image' || b.type === 'document') && b.attachmentId ? [b.attachmentId] : []));
      await run(conv.id, { text, editMessageId: messageId, attachmentIds });
    },
    stop: async () => {
      const conv = get().current;
      if (!conv) return;
      // Keep listening so the server's final partial message is received and saved.
      try { await api.conversations.stop(conv.id); }
      catch (e) {
        const error = e instanceof Error ? e.message : 'Failed to stop response';
        const active = runs.get(conv.id);
        if (active) active.error = error;
        if (get().current?.id === conv.id) set({ error });
      }
    },
    resolveApproval: async (ok) => {
      const a = get().approval;
      if (!a) return;
      const active = runs.get(get().current?.id ?? '');
      if (active) active.approval = null;
      set({ approval: null });
      await api.approvals.resolve(a.requestId, ok).catch(() => {});
    },
    clearError: () => {
      const active = runs.get(get().current?.id ?? '');
      if (active) active.error = null;
      set({ error: null });
    },
  };
});
