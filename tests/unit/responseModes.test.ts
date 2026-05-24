import { describe, it, expect } from 'vitest';
import {
  buildPageInfo,
  ANTI_HALLUCINATION_BANNER,
  RESPONSE_MODES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../src/domain/responseModes.js';

// ─── buildPageInfo ────────────────────────────────────────────────────────────

describe('buildPageInfo', () => {
  it('isComplete is true when nextCursor is null', () => {
    const info = buildPageInfo(10, 0, 50, 10, null);
    expect(info.isComplete).toBe(true);
    expect(info.nextCursor).toBeNull();
  });

  it('isComplete is false when nextCursor is a string', () => {
    const info = buildPageInfo(100, 0, 50, 50, 'some-cursor');
    expect(info.isComplete).toBe(false);
    expect(info.nextCursor).toBe('some-cursor');
  });

  it('returns correct field values', () => {
    const info = buildPageInfo(75, 25, 50, 50, 'cursor-abc');
    expect(info.totalMatched).toBe(75);
    expect(info.offset).toBe(25);
    expect(info.pageSize).toBe(50);
    expect(info.returnedCount).toBe(50);
  });

  it('works for empty result set', () => {
    const info = buildPageInfo(0, 0, 50, 0, null);
    expect(info.totalMatched).toBe(0);
    expect(info.returnedCount).toBe(0);
    expect(info.isComplete).toBe(true);
  });
});

// ─── ANTI_HALLUCINATION_BANNER ────────────────────────────────────────────────

describe('ANTI_HALLUCINATION_BANNER', () => {
  it('is a non-empty string', () => {
    expect(typeof ANTI_HALLUCINATION_BANNER).toBe('string');
    expect(ANTI_HALLUCINATION_BANNER.length).toBeGreaterThan(0);
  });

  it('contains "items[]"', () => {
    expect(ANTI_HALLUCINATION_BANNER).toContain('items[]');
  });

  it('contains "nextCursor"', () => {
    expect(ANTI_HALLUCINATION_BANNER).toContain('nextCursor');
  });
});

// ─── RESPONSE_MODES ───────────────────────────────────────────────────────────

describe('RESPONSE_MODES', () => {
  it('contains overview, ids, and page', () => {
    expect(RESPONSE_MODES).toContain('overview');
    expect(RESPONSE_MODES).toContain('ids');
    expect(RESPONSE_MODES).toContain('page');
  });

  it('does NOT contain samples', () => {
    expect(RESPONSE_MODES).not.toContain('samples');
  });

  it('does NOT contain full', () => {
    expect(RESPONSE_MODES).not.toContain('full');
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('page size constants', () => {
  it('DEFAULT_PAGE_SIZE is 50', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });

  it('MAX_PAGE_SIZE is 200', () => {
    expect(MAX_PAGE_SIZE).toBe(200);
  });
});
