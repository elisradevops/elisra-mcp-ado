import { describe, it, expect } from 'vitest';
import { ConsistencyCandidateService } from '../../src/services/consistencyCandidateService.js';
import type { AdoWorkItem } from '../../src/types/ado.js';

const svc = new ConsistencyCandidateService();

function makeItem(
  id: number,
  title: string,
  description = '',
  relations?: AdoWorkItem['relations'],
  extraFields: Record<string, unknown> = {}
): AdoWorkItem {
  return {
    id,
    fields: {
      'System.Id': id,
      'System.WorkItemType': 'Requirement',
      'System.Title': title,
      'System.Description': description,
      ...extraFields,
    },
    relations,
  };
}

function hierarchyReverseRel(parentId: number): AdoWorkItem['relations'] {
  return [
    {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `https://tfs/_apis/wit/workItems/${parentId}`,
      attributes: {},
    },
  ];
}

// ─── title-tokens grouping ────────────────────────────────────────────────────

describe('ConsistencyCandidateService — title-tokens mode', () => {
  it('detects near-duplicate titles (differ by one token)', () => {
    // "credentials" is the only extra token in A — Jaccard = 8/9 ≈ 0.89
    const a = makeItem(1, 'System shall authenticate users using username and password credentials');
    const b = makeItem(2, 'System shall authenticate users using username and password');

    const result = svc.findCandidates([a, b], 'title-tokens');
    expect(result.totalAnalyzed).toBe(2);
    const nearDup = result.candidatePairs.find((p) => p.kind === 'near_duplicate');
    expect(nearDup).toBeDefined();
    expect(nearDup?.confidence).toBe('high');
  });

  it('detects conflicting numeric threshold — AES key sizes differ', () => {
    // Jaccard 0.8 (< 0.85) → falls through to conflicting_threshold check
    const a = makeItem(1, 'System shall encrypt data at rest using AES-256');
    const b = makeItem(2, 'System shall encrypt data at rest using AES-128');

    const result = svc.findCandidates([a, b], 'title-tokens');
    const threshold = result.candidatePairs.find((p) => p.kind === 'conflicting_threshold');
    expect(threshold).toBeDefined();
    expect(threshold?.confidence).toBe('medium');
  });

  it('detects conflicting numeric threshold from description', () => {
    const a = makeItem(1, 'System response time requirement', 'The system shall respond within 100ms.');
    const b = makeItem(2, 'System response time requirement', 'The system shall respond within 500ms.');

    const result = svc.findCandidates([a, b], 'title-tokens');
    const threshold = result.candidatePairs.find((p) => p.kind === 'conflicting_threshold');
    expect(threshold).toBeDefined();
  });

  it('detects contradictory shall / shall not', () => {
    const a = makeItem(1, 'User authentication system', 'The system shall allow anonymous access.');
    const b = makeItem(2, 'User authentication system', 'The system shall not allow anonymous access.');

    const result = svc.findCandidates([a, b], 'title-tokens');
    const contradiction = result.candidatePairs.find((p) => p.kind === 'contradictory_shall');
    expect(contradiction).toBeDefined();
    expect(contradiction?.confidence).toBe('medium');
  });

  it('returns no candidates for completely different requirements', () => {
    const a = makeItem(1, 'System shall encrypt data using AES');
    const b = makeItem(2, 'User interface shall display dashboard on login');

    const result = svc.findCandidates([a, b], 'title-tokens');
    expect(result.candidatePairs).toHaveLength(0);
  });

  it('singleton groups produce no candidates', () => {
    const a = makeItem(1, 'Unique requirement about cryptography standards');
    const b = makeItem(2, 'Totally different requirement about network latency');

    const result = svc.findCandidates([a, b], 'title-tokens');
    expect(result.candidatePairs).toHaveLength(0);
  });

  it('deduplicates pair (a,b) vs (b,a)', () => {
    // Near-duplicate: same sentence + one extra word
    const a = makeItem(1, 'System shall authenticate users using username and password credentials');
    const b = makeItem(2, 'System shall authenticate users using username and password');

    const result = svc.findCandidates([a, b], 'title-tokens');
    const pairs = result.candidatePairs.filter(
      (p) =>
        (p.itemA.id === 1 && p.itemB.id === 2) ||
        (p.itemA.id === 2 && p.itemB.id === 1)
    );
    expect(pairs.length).toBeLessThanOrEqual(1);
  });
});

// ─── parent grouping ──────────────────────────────────────────────────────────

describe('ConsistencyCandidateService — parent mode', () => {
  it('groups by parent and finds candidates', () => {
    // Near-duplicate titles under same parent
    const a = makeItem(1,
      'System shall authenticate users using username and password credentials',
      '', hierarchyReverseRel(100));
    const b = makeItem(2,
      'System shall authenticate users using username and password',
      '', hierarchyReverseRel(100));
    const c = makeItem(3,
      'System shall log all network access attempts',
      '', hierarchyReverseRel(200));

    const result = svc.findCandidates([a, b, c], 'parent');
    expect(result.totalGroups).toBeGreaterThanOrEqual(1);
    const nearDup = result.candidatePairs.find((p) => p.kind === 'near_duplicate');
    expect(nearDup).toBeDefined();
    expect(nearDup?.groupBy).toBe('parent');
  });

  it('items without parent relation are excluded from groups', () => {
    const a = makeItem(1, 'Requirement without parent');
    const b = makeItem(2, 'Another requirement without parent');

    const result = svc.findCandidates([a, b], 'parent');
    expect(result.totalGroups).toBe(0);
    expect(result.candidatePairs).toHaveLength(0);
  });
});

// ─── field grouping ───────────────────────────────────────────────────────────

describe('ConsistencyCandidateService — field mode', () => {
  it('groups by field value and finds candidates', () => {
    const a = makeItem(1,
      'System shall authenticate users using username and password credentials',
      '', undefined, { 'Custom.SubSystem': 'Security' });
    const b = makeItem(2,
      'System shall authenticate users using username and password',
      '', undefined, { 'Custom.SubSystem': 'Security' });
    const c = makeItem(3,
      'System shall log all access events',
      '', undefined, { 'Custom.SubSystem': 'Logging' });

    const result = svc.findCandidates([a, b, c], 'field', { comparisonField: 'Custom.SubSystem' });
    expect(result.totalGroups).toBeGreaterThanOrEqual(1);
    const nearDup = result.candidatePairs.find((p) => p.kind === 'near_duplicate');
    expect(nearDup).toBeDefined();
  });

  it('throws when comparisonField is missing', () => {
    const a = makeItem(1, 'Req A');
    expect(() => svc.findCandidates([a], 'field')).toThrow('comparisonField is required');
  });

  it('items with empty field value are excluded from groups', () => {
    const a = makeItem(1, 'Req A', '', undefined, { 'Custom.SubSystem': '' });
    const b = makeItem(2, 'Req B', '', undefined, { 'Custom.SubSystem': undefined });

    const result = svc.findCandidates([a, b], 'field', { comparisonField: 'Custom.SubSystem' });
    expect(result.totalGroups).toBe(0);
  });
});

// ─── maxGroupSize guard ───────────────────────────────────────────────────────

describe('ConsistencyCandidateService — maxGroupSize', () => {
  it('skips groups exceeding maxGroupSize and emits truncatedGroups entry', () => {
    // 6 items that all share the same title-token group key
    const items = Array.from({ length: 6 }, (_, i) =>
      makeItem(i + 1, 'System shall encrypt stored data at rest using key')
    );

    const result = svc.findCandidates(items, 'title-tokens', { maxGroupSize: 5 });
    expect(result.truncatedGroups).toHaveLength(1);
    expect(result.truncatedGroups[0].size).toBe(6);
    expect(result.truncatedGroups[0].maxAllowed).toBe(5);
    expect(result.candidatePairs).toHaveLength(0); // group was skipped entirely
  });

  it('does NOT fall back to O(N²) when group exceeds maxGroupSize', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem(i + 1, 'Same title tokens for all items in this group here')
    );

    const result = svc.findCandidates(items, 'title-tokens', { maxGroupSize: 5 });
    expect(result.candidatePairs).toHaveLength(0);
    expect(result.truncatedGroups).toHaveLength(1);
  });

  it('processes groups at exactly maxGroupSize', () => {
    const a = makeItem(1, 'System shall authenticate users using username and password credentials');
    const b = makeItem(2, 'System shall authenticate users using username and password');

    const result = svc.findCandidates([a, b], 'title-tokens', { maxGroupSize: 2 });
    expect(result.truncatedGroups).toHaveLength(0);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('ConsistencyCandidateService — edge cases', () => {
  it('returns empty result for empty input', () => {
    const result = svc.findCandidates([], 'title-tokens');
    expect(result.totalAnalyzed).toBe(0);
    expect(result.totalGroups).toBe(0);
    expect(result.candidatePairs).toHaveLength(0);
    expect(result.truncatedGroups).toHaveLength(0);
  });

  it('returns empty result for single item', () => {
    const result = svc.findCandidates([makeItem(1, 'Single requirement')], 'title-tokens');
    expect(result.candidatePairs).toHaveLength(0);
  });
});
