/**
 * Response mode enum and helpers for all tools that return work item data.
 *
 * overview — counts + IDs only; no field payloads
 * ids      — ID list only; no fields
 * page     — paginated records with cursor-based continuation
 */

export type ResponseMode = 'overview' | 'ids' | 'page';

export const RESPONSE_MODES: readonly ResponseMode[] = ['overview', 'ids', 'page'];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PageInfo {
  totalMatched: number;
  offset: number;
  pageSize: number;
  returnedCount: number;
  nextCursor: string | null;
  isComplete: boolean;
}

export function buildPageInfo(
  totalMatched: number,
  offset: number,
  pageSize: number,
  returnedCount: number,
  nextCursor: string | null
): PageInfo {
  return {
    totalMatched,
    offset,
    pageSize,
    returnedCount,
    nextCursor,
    isComplete: nextCursor === null,
  };
}

// ─── Anti-hallucination banner ────────────────────────────────────────────────

export const ANTI_HALLUCINATION_BANNER =
  'Use ONLY the work items in items[] for analysis. Do NOT infer, summarize, or invent items not present. If pageInfo.isComplete=false, call this tool again with cursor=pageInfo.nextCursor to fetch the next page before drawing conclusions.';
