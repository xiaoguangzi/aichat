import { useEffect, useState, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import { loopPhase } from '../../lib/motion.js';

/** Below this the wait reads as normal latency and the breathing mark is enough. */
const SHOW_TIMER_AFTER = 3;
/** Past this the gateway is queueing us, not thinking — say so instead of looking hung. */
const SLOW_AFTER = 12;

/** The mark that stands for "the model is at work": waiting and thinking. */
export function PresenceDot({ className }: { className?: string }) {
  const [phase] = useState(() => loopPhase(1600));
  return <span aria-hidden className={cn('presence-dot', className)} style={{ '--phase': phase } as CSSProperties} />;
}

/**
 * Shown from the moment a run starts until its first output.
 *
 * `message_start` reaches the browser a few milliseconds after send, but a gateway can then sit
 * on the upstream request for 10-20s without emitting a single byte, so there is nothing to
 * render in between. An elapsed counter makes that stretch legible and keeps it distinguishable
 * from a dead stream.
 *
 * The list shows this as a placeholder before the reply exists and the reply shows it again
 * until it has content. Both pass the same `since`, and the entrance is timed from it, so the
 * handoff between the two mounts is not visible.
 */
export function PendingIndicator({ since }: { since: number }) {
  const [secs, setSecs] = useState(() => elapsed(since));
  const [style] = useState(() => ({ '--since': `-${Math.max(0, Date.now() - since)}ms` }) as CSSProperties);

  useEffect(() => {
    setSecs(elapsed(since));
    const t = setInterval(() => setSecs(elapsed(since)), 1000);
    return () => clearInterval(t);
  }, [since]);

  const slow = secs >= SLOW_AFTER;

  return (
    <div className={cn('presence', slow && 'is-slow')} style={style} role="status">
      <PresenceDot />
      <span className="font-medium">Waiting for the model…</span>
      {secs >= SHOW_TIMER_AFTER && <span className="presence-meta font-mono tabular-nums">{secs}s</span>}
      {slow && <span className="presence-meta">· provider is slow to respond</span>}
    </div>
  );
}

function elapsed(since: number): number {
  return Math.max(0, Math.round((Date.now() - since) / 1000));
}
