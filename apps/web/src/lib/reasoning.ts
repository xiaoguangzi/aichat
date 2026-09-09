import { DEFAULT_REASONING_LEVEL, REASONING_LEVELS, type ReasoningLevel } from '@aichat/shared';

const KEY = 'aichat.reasoning';

/**
 * The effort a new conversation starts at: whatever the user last picked, else the app default.
 * Narrowed to the levels the current model accepts so the picker never shows a value it cannot
 * send (the server clamps the same way for conversations created outside the UI).
 */
export function defaultReasoning(levels: ReasoningLevel[] = [...REASONING_LEVELS]): ReasoningLevel {
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* private mode */ }
  const want = (REASONING_LEVELS as readonly string[]).includes(stored ?? '') ? (stored as ReasoningLevel) : DEFAULT_REASONING_LEVEL;
  if (!levels.length || levels.includes(want)) return want;
  const rank = REASONING_LEVELS.indexOf(want);
  for (let d = 1; d < REASONING_LEVELS.length; d++) {
    const down = REASONING_LEVELS[rank - d];
    if (down && levels.includes(down)) return down;
    const up = REASONING_LEVELS[rank + d];
    if (up && levels.includes(up)) return up;
  }
  return levels[0]!;
}

export function rememberReasoning(level: ReasoningLevel) {
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
}
