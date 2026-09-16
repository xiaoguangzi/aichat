import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Message } from '@aichat/shared';
import { List, X } from 'lucide-react';

export function messageLabel(message: Message): string {
  const text = message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join(' ').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const names = message.content.flatMap((block) => block.type === 'document' ? [block.name] : []);
  if (names.length) return names.join('、');
  return message.content.some((block) => block.type === 'image') ? '图片消息' : '空白消息';
}

export function MessageNavigation({ messages, scrollRef, onJump }: {
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !messages.length) return;
    let frame = 0;
    const update = () => {
      const anchors = Array.from(scroller.querySelectorAll<HTMLElement>('[data-user-message-id]'));
      const threshold = scroller.getBoundingClientRect().top + 48;
      let id = anchors[0]?.dataset.userMessageId;
      for (const anchor of anchors) {
        if (anchor.getBoundingClientRect().top > threshold) break;
        id = anchor.dataset.userMessageId;
      }
      // The last short turn cannot always reach the top of the viewport.
      if (scroller.scrollTop > 0 && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2) id = messages.at(-1)?.id;
      setActiveId(id);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    scroller.addEventListener('contentvisibilityautostatechange', schedule, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener('scroll', schedule);
      scroller.removeEventListener('contentvisibilityautostatechange', schedule, true);
    };
  }, [messages, scrollRef]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    const panel = list.current;
    const active = panel?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!panel || !active) return;
    // Scroll only the navigation panel, never the conversation or document.
    if (active.offsetTop < panel.scrollTop) panel.scrollTop = active.offsetTop;
    else if (active.offsetTop + active.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = active.offsetTop + active.offsetHeight - panel.clientHeight;
    }
  }, [activeId, open]);

  if (!messages.length) return null;
  return <nav ref={root} aria-label="会话导航" className="message-navigation" data-open={open}
    onMouseEnter={() => { if (window.matchMedia?.('(hover: hover)').matches) setOpen(true); }}
    onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); event.stopPropagation(); }
    }}>
    <button ref={trigger} type="button" className="message-navigation-trigger" aria-label="提问导航"
      title="提问导航" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(true)}>
      <List size={16} className="message-navigation-icon" />
      <span className="message-navigation-rail" aria-hidden="true">
        {messages.slice(Math.max(0, messages.findIndex((message) => message.id === activeId) - 7), Math.max(14, messages.findIndex((message) => message.id === activeId) + 7)).map((message) =>
          <span key={message.id} data-active={message.id === activeId} />)}
      </span>
    </button>
    {open && <div id={panelId} className="message-navigation-panel">
      <div className="message-navigation-heading"><span>本次会话 <span className="font-normal opacity-60">{messages.length}</span></span>
        <button type="button" aria-label="收起提问导航" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={15} /></button>
      </div>
      <div ref={list} className="message-navigation-list">
        {messages.map((message, index) => {
          const label = messageLabel(message);
          return <button key={message.id} type="button" title={label} aria-label={`跳转到第 ${index + 1} 条提问：${label}`}
            aria-current={message.id === activeId ? 'location' : undefined}
            onClick={() => { onJump(message.id); setActiveId(message.id); setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
            <span className="truncate">{label}</span><span className="message-navigation-mark" aria-hidden="true" />
          </button>;
        })}
      </div>
    </div>}
  </nav>;
}
