import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, ToolResultBlock, Usage } from '@aichat/shared';
import { useChat } from '../../store/chat';
import { useSettings } from '../../store/settings';
import { MessageItem } from './MessageItem';
import { LogoMark } from '../ui/Logo';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { sumUsage } from '../../lib/usage';

/** messages mounted synchronously on a conversation switch; the rest streams in right after */
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

  // One assistant turn is persisted as several messages when the model calls tools
  // (model -> tools -> model -> …); the tool_result carriers in between are already filtered
  // out of `visible`, so a run of adjacent assistant messages is one reply. Rendering each as
  // its own block put a hover footer row plus the 28px list gap in the middle of that reply —
  // the empty band the tool cards appeared to float in. Group the run instead: only the last
  // message of it carries the footer, and the others cancel the list gap above them so the
  // whole turn keeps the 10px rhythm its own thinking/tool cards use (28px gap + 10px margin).
  const groups = useMemo(() => {
    const chain = liveStreaming ? [...visible, liveStreaming] : visible;
    const map = new Map<string, { continued: boolean; groupEnd: boolean; usage?: Usage; text?: string }>();
    chain.forEach((m, i) => {
      const continued = m.role === 'assistant' && chain[i - 1]?.role === 'assistant';
      // A `tool_use` stop is mid-turn even before the next message exists, so no footer flashes
      // in (and out again) under the tool cards between two steps of a running turn.
      const groupEnd =
        m.role === 'assistant' && chain[i + 1]?.role !== 'assistant' && !(running && m.stopReason === 'tool_use');
      let usage: Usage | undefined;
      let text: string | undefined;
      if (groupEnd) {
        let start = i;
        while (start > 0 && chain[start - 1]!.role === 'assistant') start--;
        const run = chain.slice(start, i + 1);
        if (run.length > 1) {
          // the turn's cost is the sum of the calls it took, not just the last one
          usage = sumUsage(run.map(r => r.usage));
          text = run
            .flatMap((r) => r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text))
            .join('\n');
        }
      }
      map.set(m.id, { continued, groupEnd, usage, text });
    });
    return map;
  }, [visible, liveStreaming, running]);

  const onRegenerate = useCallback(() => void regenerate(), [regenerate]);
  const onEdit = useCallback((messageId: string, text: string) => void editAndResend(messageId, text), [editAndResend]);

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
    if (budget >= visible.length) return;
    const t = setTimeout(() => startTransition(() => setBudget(Number.MAX_SAFE_INTEGER)), 0);
    return () => clearTimeout(t);
  }, [budget, visible.length, currentId]);

  const rendered = budget >= visible.length ? visible : visible.slice(visible.length - budget);

  const wasRunning = useRef(running);
  useLayoutEffect(() => {
    // Sending, regenerating or editing starts a fresh turn. A pause from reading
    // the previous reply must not carry over; pauses within this turn still do.
    if (running && !wasRunning.current) stick.current = true;
    wasRunning.current = running;
    pin();
  }, [rendered, liveStreaming, currentId, running, pin]);

  const show = (m: Message) => m.role === 'assistant' || m.content.some((b) => b.type !== 'tool_result');

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
        {rendered.map((m) => {
          const g = groups.get(m.id);
          return (
            <div key={m.id} className={cn('msg-item', g?.continued && '-mt-[2.375rem]')}>
              <MessageItem
                message={m}
                results={results}
                isLastAssistant={m.id === lastAssistantId && !running}
                showFooter={m.role !== 'assistant' || !!g?.groupEnd}
                footerUsage={g?.usage}
                footerText={g?.text}
                onRegenerate={m.role === 'assistant' ? onRegenerate : undefined}
                onEdit={m.role === 'user' && !running ? onEdit : undefined}
              />
            </div>
          );
        })}
        {liveStreaming && show(liveStreaming) && (
          <div className={cn(groups.get(liveStreaming.id)?.continued && '-mt-[2.375rem]')}>
            <MessageItem message={liveStreaming} streaming results={results} />
          </div>
        )}
      </div>
    </div>
  );
}
