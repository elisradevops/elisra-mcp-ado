import { describe, it, expect } from 'vitest';
import {
  checkFullModeGuard,
  takeSampleIds,
  buildOverviewPayload,
  OVERVIEW_SAMPLE_IDS,
  DEFAULT_SAMPLE_SIZE,
} from '../../src/domain/responseModes.js';

// ─── checkFullModeGuard ───────────────────────────────────────────────────────

describe('checkFullModeGuard', () => {
  it('allows when count equals cap', () => {
    const result = checkFullModeGuard(50, 50);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows when count is below cap', () => {
    const result = checkFullModeGuard(10, 50);
    expect(result.allowed).toBe(true);
  });

  it('rejects when count exceeds cap', () => {
    const result = checkFullModeGuard(51, 50);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('51');
    expect(result.reason).toContain('50');
    expect(result.reason).toContain('Full mode rejected');
  });

  it('reason mentions narrowing scope', () => {
    const result = checkFullModeGuard(100, 50);
    expect(result.reason).toContain('samples');
  });

  it('allows zero items', () => {
    const result = checkFullModeGuard(0, 50);
    expect(result.allowed).toBe(true);
  });

  it('rejects when cap is 0 and count > 0', () => {
    const result = checkFullModeGuard(1, 0);
    expect(result.allowed).toBe(false);
  });
});

// ─── takeSampleIds ────────────────────────────────────────────────────────────

describe('takeSampleIds', () => {
  it('returns first N IDs', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    expect(takeSampleIds(ids)).toHaveLength(OVERVIEW_SAMPLE_IDS);
    expect(takeSampleIds(ids)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns all IDs when fewer than N', () => {
    const ids = [10, 20];
    expect(takeSampleIds(ids)).toEqual([10, 20]);
  });

  it('accepts custom n', () => {
    const ids = [1, 2, 3, 4, 5, 6];
    expect(takeSampleIds(ids, 3)).toEqual([1, 2, 3]);
  });

  it('returns empty array for empty input', () => {
    expect(takeSampleIds([])).toEqual([]);
  });
});

// ─── buildOverviewPayload ─────────────────────────────────────────────────────

describe('buildOverviewPayload', () => {
  it('includes totalMatched and sampleIds', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const payload = buildOverviewPayload(ids);
    expect(payload.totalMatched).toBe(7);
    expect(payload.sampleIds).toEqual([1, 2, 3, 4, 5]);
  });

  it('merges extraFields', () => {
    const ids = [1, 2];
    const payload = buildOverviewPayload(ids, { project: 'MyProject', warnings: [] });
    expect(payload.project).toBe('MyProject');
    expect(payload.warnings).toEqual([]);
    expect(payload.totalMatched).toBe(2);
  });

  it('extraFields can override totalMatched', () => {
    const ids = [1, 2, 3];
    // extraFields spread comes after defaults — extra totalMatched overrides
    const payload = buildOverviewPayload(ids, { totalMatched: 999 });
    expect(payload.totalMatched).toBe(999);
  });

  it('empty ids gives empty sampleIds and zero totalMatched', () => {
    const payload = buildOverviewPayload([]);
    expect(payload.totalMatched).toBe(0);
    expect(payload.sampleIds).toEqual([]);
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('responseModes constants', () => {
  it('OVERVIEW_SAMPLE_IDS is 5', () => {
    expect(OVERVIEW_SAMPLE_IDS).toBe(5);
  });

  it('DEFAULT_SAMPLE_SIZE is 10', () => {
    expect(DEFAULT_SAMPLE_SIZE).toBe(10);
  });
});
