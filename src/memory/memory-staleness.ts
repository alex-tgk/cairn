/**
 * Memory staleness is a derived, read-time-only signal: it is never stored,
 * never migrated, and never affects ranking or filtering on its own. It
 * exists purely so `memory` commands can surface "how long since this was
 * last confirmed true" alongside each memory.
 *
 * Age is measured from `updatedAt` rather than `createdAt`, since a
 * topic-key upsert (ADR 0010) bumps `updatedAt` in place and that better
 * reflects when the memory's content was last confirmed, not merely when
 * the row was first created.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_STALE_AFTER_DAYS = 90;

/**
 * The number of whole UTC days elapsed between `referenceIso` (typically a
 * memory's `updatedAt`) and `nowIso`. Both inputs are ISO 8601 timestamps.
 * Deterministic and clock-free: callers supply `nowIso` explicitly.
 */
export function computeMemoryAgeDays(referenceIso: string, nowIso: string): number {
  const referenceMs = Date.parse(referenceIso);
  const nowMs = Date.parse(nowIso);
  const diffMs = nowMs - referenceMs;
  return Math.max(0, Math.floor(diffMs / MILLISECONDS_PER_DAY));
}

export type MemoryStalenessInput = Readonly<{
  ageDays: number;
  pinned: boolean;
  staleAfterDays: number;
}>;

/**
 * Pinned memories are never stale, regardless of age: a pin is an explicit
 * "keep fresh" signal per ADR 0010's pin semantics, so it overrides age-based
 * staleness entirely.
 */
export function isMemoryStale(input: MemoryStalenessInput): boolean {
  if (input.pinned) {
    return false;
  }
  return input.ageDays > input.staleAfterDays;
}
