import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, ToolResultBlock } from '@aichat/shared';
import { useChat } from '../../store/chat';
import { useSettings } from '../../store/settings';
import { MessageItem } from './MessageItem';
import { AssistantTurn } from './AssistantTurn.js';
import { LogoMark } from '../ui/Logo';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

/** turns mounted synchronously on a conversation switch; the rest streams in right after */
const TAIL = 12;

export function MessageList() {
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const pendingResults = useChat((s) => s.pendingResults);
  const running = useChat((s) => s.running);
  const currentId = useChat((s) => s.current?.id);
  const regenerate = useChat((s) => s.regenerate);
  const editAndResend = useChat((s) => s.editAndResend);
  const skills = useSettings((s) => s.skills);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastScrollTop = useRef(0);

  // a stream belonging to another conversation must not bleed into this one
  const liveStreaming = streaming && streaming.conversationId === currentId ? streaming : null;

  const results = useMemo(() => {
    const map: Record<string, ToolResultBlock> = { ...pendingResults };
    for (const m of messages) for (const b of m.content) if (b.type === 'tool_result') map[b.tool_use_id] = b;
    return map;
  }, [messages, pendingResults]);

  const visible = useMemo(() => messages.filter((m) => !(m.role === 'user' && m.content.every((b) => b.type === 'tool_result'))), [messages]);
  const lastAssistantId = useMemo(() => [...visible].reverse().find((m) => m.role === 'assistant')?.id, [visible]);

  // Keep a whole tool loop under one stable key, including its live -> persisted
  // handoff. This preserves the reader's disclosure choice as new steps arrive.
  const groups = useMemo(() => {
    const chain = liveStreaming ? [...visible, liveStreaming] : visible;
    const turns: Message[][] = [];
    for (const message of chain) {
      const previous = turns.at(-1);
      if (message.role === 'assistant' && previous?.[0]?.role === 'assistant') {
        previous.push(message);
      } else {
        turns.push([message]);
      }
    }
    return turns;
  }, [visible, liveStreaming]);

  const onRegenerate = useCallback(() => void regenerate(), [regenerate]);
  const onEdit = useCallback((messageId: string, text: string) => void editAndResend(messageId, text), [editAndResend]);
  // Expanding the process is an explicit reading action. Its height change must
  // not pin the list to the bottom and move the newly opened cards out of view.
  const onProcessToggle = useCallback(() => { stick.current = false; }, []);

  const inner = useRef<HTMLDivElement>(null);
  const pin = useCallback(() => {
    const el = ref.current;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      // Scroll events arrive asynchronously, after this function has returned.
      lastScrollTop.current = Math.max(0, el.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const top = Math.max(0, el.scrollTop);
      const delta = top - lastScrollTop.current;
      if (delta < 0) stick.current = false;
      else if (delta > 0) stick.current = el.scrollHeight - top - el.clientHeight < 80;
      lastScrollTop.current = top;
    };
    // At the boundary a gesture may produce no scroll event at all. Stop following
    // before the next stream update can pull the reader back toward the bottom.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stick.current = false;
    };
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY !== undefined && touchY !== undefined && nextY > touchY) stick.current = false;
      touchY = nextY;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Message heights are not known at commit time: `content-visibility: auto` lays every
  // offscreen item out at its `contain-intrinsic-size` guess, markdown/code blocks reflow,
  // images decode late. Pinning only in an effect therefore scrolls to a scrollHeight that
  // is about to change, which is what makes a conversation switch jump around. Re-pin from a
  // ResizeObserver (it fires before paint) so the list is at the bottom on the first frame.
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(pin);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pin]);

  // A long conversation is thousands of DOM nodes; mounting them all in the click's commit is
  // what makes switching feel stuck (`content-visibility` only skips layout/paint, React still
  // builds every node). Mount the tail — everything the reader actually looks at — in that
  // commit, then fill the history in behind it as an interruptible transition.
  const [budget, setBudget] = useState(TAIL);

  // switching conversations resets stickiness so the new list opens at the bottom
  const prevConv = useRef(currentId);
  if (prevConv.current !== currentId) {
    prevConv.current = currentId;
    stick.current = true;
    if (budget !== TAIL) setBudget(TAIL);
  }

  useEffect(() => {
    if (budget >= groups.length) return;
    const t = setTimeout(() => startTransition(() => setBudget(Number.MAX_SAFE_INTEGER)), 0);
    return () => clearTimeout(t);
  }, [budget, groups.length, currentId]);

  const rendered = budget >= groups.length ? groups : groups.slice(groups.length - budget);

  const wasRunning = useRef(running);
  useLayoutEffect(() => {
    // Sending, regenerating or editing starts a fresh turn. A pause from reading
    // the previous reply must not carry over; pauses within this turn still do.
    if (running && !wasRunning.current) stick.current = true;
    wasRunning.current = running;
    pin();
  }, [rendered, liveStreaming, currentId, running, pin]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto overscroll-y-none px-4 py-8">
      <div ref={inner} className="mx-auto flex max-w-3xl flex-col gap-7">
        {visible.length === 0 && !liveStreaming && (
          <div className="fade-in mt-24 flex flex-col items-center text-center px-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/10 shadow-inner ring-1 ring-accent-500/20 mb-4">
              <LogoMark size="lg" />
            </div>
            <div className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              How can I help you today?
            </div>
            <div className="mt-2 text-sm text-zinc-400 dark:text-zinc-500 max-w-md">
              Send a message to start a conversation, or type{' '}
              <kbd className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                /
              </kbd>{' '}
              to invoke specialized skills.
            </div>
            {skills.length > 0 && (
              <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-xl">
                {skills.slice(0, 6).map((sk) => (
                  <div
                    key={sk.name}
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 shadow-2xs"
                  >
                    <Sparkles size={11} className="text-accent-500" />
                    <span className="font-mono font-medium">/{sk.name}</span>
                    <span className="text-zinc-400 max-w-36 truncate">{sk.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {rendered.map((turn) => {
          const first = turn[0]!;
          const last = turn.at(-1)!;
          const active = running && turn === groups.at(-1);
          return (
            <div key={first.id} className={cn(!active && 'msg-item')}>
              {first.role === 'assistant' ? <AssistantTurn
                messages={turn}
                streamingId={liveStreaming?.id}
                running={active}
                results={results}
                isLastAssistant={last.id === lastAssistantId && !running}
                onRegenerate={onRegenerate}
                onProcessToggle={onProcessToggle}
              /> : <MessageItem message={first} results={results} onEdit={!running ? onEdit : undefined} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
