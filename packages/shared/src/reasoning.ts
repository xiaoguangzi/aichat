import type { ReasoningLevel, ReasoningMap } from './types.js';

/** The unified effort dial, ascending. `off` is a level like any other (thinking disabled). */
export const REASONING_LEVELS: readonly ReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Levels a model's endpoint accepts — what the chat effort picker offers. Everything is
 * supported unless the model's map marks it null, so a freshly added model is fully open
 * instead of waiting for a code change (no model-name matching anywhere).
 */
export function supportedReasoningLevels(m: {
  caps: { thinking: boolean };
  reasoningMap?: ReasoningMap | null;
}): ReasoningLevel[] {
  if (!m.caps.thinking) return [];
  const map = m.reasoningMap ?? {};
  return REASONING_LEVELS.filter((l) => !(l in map && map[l] === null));
}

/** Used when a conversation has not chosen a level (and by the UI as its initial value). */
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = 'high';

/**
 * The level to actually send for a request. A thinking model always gets a concrete level —
 * "send no thinking params at all" is not a safe default: gateways like Z.AI reject a request
 * with no thinking field ("[1210] This model always engages in thinking and cannot be disabled"),
 * and endpoints that accept it just think as little as they like.
 * A level the model does not accept falls back to the nearest one it does.
 */
export function resolveReasoningLevel(
  m: { caps: { thinking: boolean }; reasoningMap?: ReasoningMap | null },
  requested: ReasoningLevel | null | undefined,
): ReasoningLevel {
  if (!m.caps.thinking) return 'off';
  const levels = supportedReasoningLevels(m);
  if (!levels.length) return 'off';
  const want = requested ?? DEFAULT_REASONING_LEVEL;
  if (levels.includes(want)) return want;
  const rank = REASONING_LEVELS.indexOf(want);
  for (let d = 1; d < REASONING_LEVELS.length; d++) {
    const down = REASONING_LEVELS[rank - d];
    if (down && levels.includes(down)) return down;
    const up = REASONING_LEVELS[rank + d];
    if (up && levels.includes(up)) return up;
  }
  return levels[0]!;
}
