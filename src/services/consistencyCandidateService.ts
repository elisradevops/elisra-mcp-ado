import type { AdoWorkItem } from '../types/ado.js';
import { htmlToText } from '../utils/htmlToText.js';
import { ADO_LINK_TYPES } from '../domain/adoLinkTypes.js';

export type ComparisonMode = 'parent' | 'field' | 'title-tokens';

export interface CandidatePair {
  itemA: { id: number; title: string; workItemType: string };
  itemB: { id: number; title: string; workItemType: string };
  reason: string;
  kind: 'near_duplicate' | 'conflicting_threshold' | 'contradictory_shall' | 'unit_mismatch';
  confidence: 'high' | 'medium' | 'low';
  groupKey: string;
  groupBy: string;
}

export interface TruncatedGroup {
  groupKey: string;
  groupBy: string;
  size: number;
  maxAllowed: number;
}

export interface ConsistencyCandidateResult {
  totalAnalyzed: number;
  totalGroups: number;
  candidatePairs: CandidatePair[];
  truncatedGroups: TruncatedGroup[];
}

const DEFAULT_MAX_GROUP_SIZE = 25;
const TOP_TITLE_TOKENS = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function titleTokenKey(title: string): string {
  // Take the first TOP_TITLE_TOKENS significant tokens (skip stop words)
  const STOP = new Set(['the', 'and', 'for', 'shall', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'its']);
  const tokens = tokenize(title).filter((t) => !STOP.has(t));
  return tokens.slice(0, TOP_TITLE_TOKENS).sort().join('|');
}

function extractNumericValues(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return matches.map(Number);
}

function fieldText(item: AdoWorkItem, field: string): string {
  const raw = item.fields[field];
  if (!raw) return '';
  return htmlToText(String(raw));
}

// ─── Group builders ───────────────────────────────────────────────────────────

function groupByParent(items: AdoWorkItem[]): Map<string, AdoWorkItem[]> {
  const groups = new Map<string, AdoWorkItem[]>();

  for (const item of items) {
    const parentRel = (item.relations ?? []).find((r) => r.rel === ADO_LINK_TYPES.HIERARCHY_REVERSE);
    if (!parentRel) continue;

    const m = /\/workItems\/(\d+)/i.exec(parentRel.url);
    const key = m ? `parent:${m[1]}` : undefined;
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return groups;
}

function groupByField(items: AdoWorkItem[], field: string): Map<string, AdoWorkItem[]> {
  const groups = new Map<string, AdoWorkItem[]>();

  for (const item of items) {
    const raw = item.fields[field];
    if (raw === undefined || raw === null || raw === '') continue;

    const key = `${field}:${String(raw)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return groups;
}

function groupByTitleTokens(items: AdoWorkItem[]): Map<string, AdoWorkItem[]> {
  const groups = new Map<string, AdoWorkItem[]>();

  for (const item of items) {
    const title = String(item.fields['System.Title'] ?? '');
    const key = titleTokenKey(title);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  // Only keep groups with ≥ 2 items — singletons can't be candidates
  for (const [key, members] of groups) {
    if (members.length < 2) groups.delete(key);
  }

  return groups;
}

// ─── Pair heuristics ──────────────────────────────────────────────────────────

function comparePair(
  a: AdoWorkItem,
  b: AdoWorkItem,
  groupKey: string,
  groupBy: string
): CandidatePair | null {
  const titleA = String(a.fields['System.Title'] ?? '');
  const titleB = String(b.fields['System.Title'] ?? '');
  const descA = fieldText(a, 'System.Description');
  const descB = fieldText(b, 'System.Description');

  const toksA = tokenSet(titleA);
  const toksB = tokenSet(titleB);
  const jaccard = jaccardSimilarity(toksA, toksB);

  // Near-duplicate title
  if (jaccard >= 0.85 && (titleA !== titleB)) {
    return {
      itemA: { id: a.id, title: titleA, workItemType: String(a.fields['System.WorkItemType'] ?? '') },
      itemB: { id: b.id, title: titleB, workItemType: String(b.fields['System.WorkItemType'] ?? '') },
      reason: `Near-duplicate titles (Jaccard: ${jaccard.toFixed(2)}).`,
      kind: 'near_duplicate',
      confidence: 'high',
      groupKey,
      groupBy,
    };
  }

  // Conflicting numeric threshold (same title tokens, different numbers)
  if (jaccard >= 0.5) {
    const numsA = extractNumericValues(`${titleA} ${descA}`);
    const numsB = extractNumericValues(`${titleB} ${descB}`);

    if (numsA.length > 0 && numsB.length > 0) {
      const diff = numsA.some((n) => !numsB.includes(n));
      if (diff) {
        return {
          itemA: { id: a.id, title: titleA, workItemType: String(a.fields['System.WorkItemType'] ?? '') },
          itemB: { id: b.id, title: titleB, workItemType: String(b.fields['System.WorkItemType'] ?? '') },
          reason: `Similar requirements with different numeric thresholds (${numsA.join(',') || '-'} vs ${numsB.join(',') || '-'}).`,
          kind: 'conflicting_threshold',
          confidence: 'medium',
          groupKey,
          groupBy,
        };
      }
    }
  }

  // Contradictory shall / shall not
  const combinedA = `${titleA} ${descA}`.toLowerCase();
  const combinedB = `${titleB} ${descB}`.toLowerCase();

  const hasShallNotA = /\bshall\s+not\b/.test(combinedA);
  const hasShallNotB = /\bshall\s+not\b/.test(combinedB);
  const hasShallA = /\bshall\b/.test(combinedA);
  const hasShallB = /\bshall\b/.test(combinedB);

  if (jaccard >= 0.4 && ((hasShallNotA && hasShallB && !hasShallNotB) || (hasShallNotB && hasShallA && !hasShallNotA))) {
    return {
      itemA: { id: a.id, title: titleA, workItemType: String(a.fields['System.WorkItemType'] ?? '') },
      itemB: { id: b.id, title: titleB, workItemType: String(b.fields['System.WorkItemType'] ?? '') },
      reason: 'One requirement uses "shall" and the other uses "shall not" on similar subject.',
      kind: 'contradictory_shall',
      confidence: 'medium',
      groupKey,
      groupBy,
    };
  }

  return null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ConsistencyCandidateService {
  findCandidates(
    items: AdoWorkItem[],
    comparisonMode: ComparisonMode,
    options: { comparisonField?: string; maxGroupSize?: number } = {}
  ): ConsistencyCandidateResult {
    const maxGroupSize = options.maxGroupSize ?? DEFAULT_MAX_GROUP_SIZE;

    let groups: Map<string, AdoWorkItem[]>;

    switch (comparisonMode) {
      case 'parent':
        groups = groupByParent(items);
        break;
      case 'field':
        if (!options.comparisonField) {
          throw new Error('comparisonField is required when comparisonMode is "field".');
        }
        groups = groupByField(items, options.comparisonField);
        break;
      case 'title-tokens':
        groups = groupByTitleTokens(items);
        break;
    }

    const candidatePairs: CandidatePair[] = [];
    const truncatedGroups: TruncatedGroup[] = [];
    const seenPairs = new Set<string>();

    for (const [groupKey, members] of groups) {
      if (members.length < 2) continue;

      const groupBy = comparisonMode === 'field' ? (options.comparisonField ?? 'field') : comparisonMode;

      if (members.length > maxGroupSize) {
        truncatedGroups.push({ groupKey, groupBy, size: members.length, maxAllowed: maxGroupSize });
        continue; // GUARDRAIL: skip group entirely — never O(N²). Caller must narrow scope.
      }

      // O(Gᵢ²) within bounded group
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          const pairKey = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const candidate = comparePair(a, b, groupKey, groupBy);
          if (candidate) candidatePairs.push(candidate);
        }
      }
    }

    return {
      totalAnalyzed: items.length,
      totalGroups: groups.size,
      candidatePairs,
      truncatedGroups,
    };
  }
}
