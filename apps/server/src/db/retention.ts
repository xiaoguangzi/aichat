import type { TraceRetention, TraceRetentionInput } from '@aichat/shared';
import { DEFAULT_TRACE_RETENTION } from '@aichat/shared';
import { settingsRepo } from './repos/settings.js';

const RETENTION_KEY = 'trace.retention';

/**
 * `null`/absent limits mean "use the built-in default". A finite limit is enforced as written;
 * `0` is not a special case — "keep nothing" is a job for the explicit clear action, not a
 * retention number someone can save by accident.
 */
export function resolveRetention(input: TraceRetentionInput | null | undefined): TraceRetention {
  const pick = (v: number | null | undefined, d: number) => (v === undefined || v === null ? d : v);
  return {
    autoPrune: input?.autoPrune ?? DEFAULT_TRACE_RETENTION.autoPrune,
    maxCount: pick(input?.maxCount, DEFAULT_TRACE_RETENTION.maxCount as number),
    maxTotalBytes: pick(input?.maxTotalBytes, DEFAULT_TRACE_RETENTION.maxTotalBytes as number),
    maxAgeDays: pick(input?.maxAgeDays, DEFAULT_TRACE_RETENTION.maxAgeDays as number),
    vacuumOnPrune: input?.vacuumOnPrune ?? DEFAULT_TRACE_RETENTION.vacuumOnPrune,
  };
}

export function readRetention(): TraceRetention {
  return resolveRetention(readRetentionInput());
}

/** The stored value as written, with unset limits still null and no defaults filled in. */
export function readRetentionInput(): TraceRetentionInput {
  return settingsRepo.get<TraceRetentionInput | null>(RETENTION_KEY, null) ?? {};
}

/**
 * Persist exactly what was submitted, without resolving defaults. Storing resolved numbers would
 * turn "never configured" into a frozen copy of today's default the first time anyone saves the
 * page, so a later change to DEFAULT_TRACE_RETENTION would silently not apply.
 */
export function writeRetention(input: TraceRetentionInput): TraceRetention {
  settingsRepo.set(RETENTION_KEY, input);
  return resolveRetention(input);
}

/** Retention without going through SQLite, for the insert-time guard. */
export function defaultRetention(): TraceRetention {
  return { ...DEFAULT_TRACE_RETENTION };
}
