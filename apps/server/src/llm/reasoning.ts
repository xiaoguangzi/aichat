import type { ReasoningLevel, ReasoningMap } from '@aichat/shared';

/**
 * Resolve the effort literal to send for a unified reasoning level.
 * A per-model override wins (null = level unsupported → send nothing); otherwise the
 * protocol default table, then the level itself.
 */
export function resolveEffortParam(
  level: ReasoningLevel,
  map: ReasoningMap | null | undefined,
  defaultFor: Partial<Record<ReasoningLevel, string>> = {},
): string | null {
  if (level === 'off') return null;
  const m = map ?? {};
  if (level in m) return m[level] ?? null;
  return defaultFor[level] ?? level;
}

/** True when the endpoint can be asked to disable thinking (reasoningMap.off === null means it cannot). */
export function canDisableThinking(map: ReasoningMap | null | undefined): boolean {
  return map?.off !== null;
}
