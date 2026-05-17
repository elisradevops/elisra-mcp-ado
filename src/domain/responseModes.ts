/**
 * Response mode enum and helpers for all tools that return work item data.
 *
 * overview — counts + sample IDs only; no field payloads
 * ids      — ID list only; no fields
 * samples  — bounded set of compact records (default 10)
 * full     — all matched items (guarded by adoFullResponseMaxItems)
 * export   — reserved for v2; not implemented
 */

export type ResponseMode = 'overview' | 'ids' | 'samples' | 'full';

export const RESPONSE_MODES: readonly ResponseMode[] = ['overview', 'ids', 'samples', 'full'];

export const OVERVIEW_SAMPLE_IDS = 5;
export const DEFAULT_SAMPLE_SIZE = 10;

// ─── Guards ───────────────────────────────────────────────────────────────────

export interface FullModeGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a "full" mode response is allowed given the item count and configured cap.
 * Returns { allowed: false, reason } when the count exceeds the cap.
 */
export function checkFullModeGuard(count: number, cap: number): FullModeGuardResult {
  if (count <= cap) return { allowed: true };
  return {
    allowed: false,
    reason:
      `Full mode rejected: ${count} items exceeds ADO_FULL_RESPONSE_MAX_ITEMS (${cap}). ` +
      `Use responseMode="samples" (with sampleSize≤50) or responseMode="overview", or narrow the scope. ` +
      `Operators can raise the cap via the ADO_FULL_RESPONSE_MAX_ITEMS environment variable.`,
  };
}

// ─── Drill-down helpers ───────────────────────────────────────────────────────

/**
 * Return the first N IDs as sample IDs for drill-down.
 * Callers can pass these into a source.type="ids" scope.
 */
export function takeSampleIds(ids: number[], n = OVERVIEW_SAMPLE_IDS): number[] {
  return ids.slice(0, n);
}

/**
 * Build a minimal overview payload that every "overview" mode response should include.
 * Includes drill-down sampleIds so the caller can immediately query specific items.
 */
export function buildOverviewPayload(
  ids: number[],
  extraFields?: Record<string, unknown>
): Record<string, unknown> {
  return {
    totalMatched: ids.length,
    sampleIds: takeSampleIds(ids),
    ...extraFields,
  };
}
