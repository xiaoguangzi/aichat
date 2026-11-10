import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { canAnimate, EASE_OUT } from '../../lib/motion.js';

/**
 * A disclosure body that opens and closes by height instead of popping.
 *
 * Children stay mounted while the closing animation runs and are unmounted when it ends, so a
 * collapsed panel costs nothing. Where animation is unavailable the panel switches state within
 * the same commit, exactly like a plain `hidden` toggle.
 */
export function Collapse({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const el = ref.current;
    // An interrupted animation hands its current height to the next one.
    const interrupted = running.current?.playState === 'running' ? el?.getBoundingClientRect().height : undefined;
    running.current?.cancel();
    running.current = null;
    if (!canAnimate(el)) {
      if (!open) setPresent(false);
      return;
    }
    const full = el.scrollHeight;
    const from = interrupted ?? (open ? 0 : full);
    const to = open ? full : 0;
    const node = el as HTMLElement;
    node.style.overflow = 'hidden';
    const animation = node.animate(
      [{ height: `${from}px`, opacity: open ? 0 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0 }],
      // Longer panels travel further, but never slowly enough to feel like waiting.
      { duration: Math.min(340, Math.max(180, 150 + Math.abs(to - from) * 0.22)), easing: EASE_OUT, fill: open ? 'none' : 'forwards' },
    );
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      node.style.overflow = '';
      if (!open) setPresent(false);
    };
  }, [open]);

  // The closed end state is held by `hidden`, not by the finished animation.
  useLayoutEffect(() => {
    if (present) return;
    running.current?.cancel();
    running.current = null;
  }, [present]);

  return (
    <div ref={ref} id={id} className={className} hidden={!present} inert={!open}>
      {present && children}
    </div>
  );
}
