import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Below this the wait reads as normal latency and a bare caret is enough. */
const SHOW_TIMER_AFTER = 3;
/** Past this the gateway is queueing us, not thinking — say so instead of looking hung. */
const SLOW_AFTER = 12;

/**
 * Shown on a streaming assistant message that has no content yet.
 *
 * `message_start` reaches the browser ~2ms after send, but a gateway can then sit on the
 * upstream request for 10-20s without emitting a single byte, so there is nothing to render
 * in between. A blinking caret alone makes that stretch look like a hang; an elapsed counter
 * makes the wait legible and keeps it distinguishable from a dead stream.
 */
export function PendingIndicator({ since }: { since: number }) {
  const [secs, setSecs] = useState(() => elapsed(since));

  useEffect(() => {
    setSecs(elapsed(since));
    const t = setInterval(() => setSecs(elapsed(since)), 1000);
    return () => clearInterval(t);
  }, [since]);

  const slow = secs >= SLOW_AFTER;

  return (
    <div
      className={cn(
        'my-2.5 inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs transition-colors duration-300',
        slow
          ? 'border-accent-300/60 dark:border-accent-800/50 bg-accent-50/60 dark:bg-accent-950/20 text-accent-700 dark:text-accent-300'
          : 'border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/40 text-zinc-600 dark:text-zinc-400',
      )}
    >
      <Loader2 size={13} className="animate-spin" />
      <span className="font-medium">Waiting for the model…</span>
      {secs >= SHOW_TIMER_AFTER && <span className="font-mono tabular-nums opacity-70">{secs}s</span>}
      {slow && <span className="opacity-80">· provider is slow to respond</span>}
    </div>
  );
}

function elapsed(since: number): number {
  return Math.max(0, Math.round((Date.now() - since) / 1000));
}
