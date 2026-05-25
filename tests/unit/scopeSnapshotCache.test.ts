import { describe, it, expect } from 'vitest';
import {
  ScopeSnapshotCache,
  encodeCursor,
  decodeCursor,
  computeSourceHash,
} from '../../src/services/scopeSnapshotCache.js';
import type { SnapshotMeta } from '../../src/services/scopeSnapshotCache.js';

const meta: SnapshotMeta = { project: 'MyProject', sourceType: 'query' };

// ─── put ──────────────────────────────────────────────────────────────────────

describe('ScopeSnapshotCache.put', () => {
  it('returns a string snapshotId', () => {
    const cache = new ScopeSnapshotCache(60_000, 100);
    const id = cache.put([1, 2, 3], meta);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns a different snapshotId on each call', () => {
    const cache = new ScopeSnapshotCache(60_000, 100);
    const id1 = cache.put([1], meta);
    const id2 = cache.put([2], meta);
    expect(id1).not.toBe(id2);
  });
});

// ─── get ──────────────────────────────────────────────────────────────────────

describe('ScopeSnapshotCache.get', () => {
  it('returns ids and meta for a valid snapshot', () => {
    const cache = new ScopeSnapshotCache(60_000, 100);
    const ids = [10, 20, 30];
    const snapshotId = cache.put(ids, meta);

    const result = cache.get(snapshotId);
    expect(result).not.toBeNull();
    expect(result!.ids).toEqual([10, 20, 30]);
    expect(result!.meta).toEqual(meta);
  });

  it('returns null for unknown snapshotId', () => {
    const cache = new ScopeSnapshotCache(60_000, 100);
    expect(cache.get('nonexistent-id')).toBeNull();
  });

  it('returns null after TTL expires', async () => {
    const cache = new ScopeSnapshotCache(1, 100); // 1ms TTL
    const id = cache.put([1, 2], meta);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(cache.get(id)).toBeNull();
  });

  it('stores reference (not clone) of ids array', () => {
    const cache = new ScopeSnapshotCache(60_000, 100);
    const ids = [1, 2, 3];
    const id = cache.put(ids, meta);
    const result = cache.get(id);
    expect(result!.ids).toBe(ids);
  });
});

// ─── LRU eviction ─────────────────────────────────────────────────────────────

describe('ScopeSnapshotCache LRU eviction', () => {
  it('evicts oldest inserted entry when maxEntries is reached', () => {
    const cache = new ScopeSnapshotCache(60_000, 3);
    const id1 = cache.put([1], meta);
    const id2 = cache.put([2], meta);
    const id3 = cache.put([3], meta);

    // Cache is full (3 entries). Adding a 4th should evict id1 (oldest inserted).
    cache.put([4], meta);

    expect(cache.get(id1)).toBeNull(); // evicted
    expect(cache.get(id2)).not.toBeNull();
    expect(cache.get(id3)).not.toBeNull();
  });

  it('bumps LRU on get: accessed entry survives, oldest unaccessed is evicted', () => {
    const cache = new ScopeSnapshotCache(60_000, 3);
    const id1 = cache.put([1], meta);
    const id2 = cache.put([2], meta);
    const id3 = cache.put([3], meta);

    // Access id1 — bumps it to the end of insertion order
    cache.get(id1);

    // Now order is: id2, id3, id1 (id2 is oldest)
    // Adding a 4th entry should evict id2
    cache.put([4], meta);

    expect(cache.get(id1)).not.toBeNull(); // was accessed — should survive
    expect(cache.get(id2)).toBeNull();     // oldest unaccessed — should be evicted
    expect(cache.get(id3)).not.toBeNull();
  });
});

// ─── encodeCursor / decodeCursor ──────────────────────────────────────────────

describe('encodeCursor + decodeCursor', () => {
  it('round-trips snapshotId and offset', () => {
    const cursor = encodeCursor('abc-123', 50);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.snapshotId).toBe('abc-123');
    expect(decoded!.offset).toBe(50);
  });

  it('round-trips with offset 0', () => {
    const cursor = encodeCursor('some-uuid', 0);
    const decoded = decodeCursor(cursor);
    expect(decoded!.offset).toBe(0);
  });

  it('returns null for garbage input', () => {
    expect(decodeCursor('!!not-base64!!')).toBeNull();
  });

  it('returns null for valid base64 but invalid JSON', () => {
    const bad = Buffer.from('not json').toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when JSON is valid but missing s field', () => {
    const bad = Buffer.from(JSON.stringify({ o: 10 })).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when JSON is valid but missing o field', () => {
    const bad = Buffer.from(JSON.stringify({ s: 'abc' })).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when o is not a number', () => {
    const bad = Buffer.from(JSON.stringify({ s: 'abc', o: '50' })).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when s is not a string', () => {
    const bad = Buffer.from(JSON.stringify({ s: 123, o: 50 })).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('decodes cursor wrapped in double quotes (LLM echo artifact)', () => {
    const cursor = encodeCursor('snap-1', 50);
    const quoted = `"${cursor}"`;
    const decoded = decodeCursor(quoted);
    expect(decoded).not.toBeNull();
    expect(decoded!.snapshotId).toBe('snap-1');
    expect(decoded!.offset).toBe(50);
  });

  it("decodes cursor wrapped in single quotes (LLM echo artifact)", () => {
    const cursor = encodeCursor('snap-2', 100);
    const quoted = `'${cursor}'`;
    const decoded = decodeCursor(quoted);
    expect(decoded).not.toBeNull();
    expect(decoded!.snapshotId).toBe('snap-2');
    expect(decoded!.offset).toBe(100);
  });

  it('decodes cursor with leading/trailing whitespace', () => {
    const cursor = encodeCursor('snap-3', 25);
    const padded = `  ${cursor}  `;
    const decoded = decodeCursor(padded);
    expect(decoded).not.toBeNull();
    expect(decoded!.snapshotId).toBe('snap-3');
    expect(decoded!.offset).toBe(25);
  });
});

// ─── computeSourceHash ────────────────────────────────────────────────────────

describe('computeSourceHash', () => {
  it('returns same hash for identical args', () => {
    const h1 = computeSourceHash('Proj', 'fieldFilters', { type: 'fieldFilters', filters: [] });
    const h2 = computeSourceHash('Proj', 'fieldFilters', { type: 'fieldFilters', filters: [] });
    expect(h1).toBe(h2);
  });

  it('returns different hash when project differs', () => {
    const h1 = computeSourceHash('ProjA', 'wiql', { type: 'wiql', wiql: 'SELECT ...' });
    const h2 = computeSourceHash('ProjB', 'wiql', { type: 'wiql', wiql: 'SELECT ...' });
    expect(h1).not.toBe(h2);
  });

  it('returns different hash when sourceType differs', () => {
    const h1 = computeSourceHash('P', 'wiql', { wiql: 'X' });
    const h2 = computeSourceHash('P', 'fieldFilters', { wiql: 'X' });
    expect(h1).not.toBe(h2);
  });

  it('returns different hash when source args differ', () => {
    const h1 = computeSourceHash('P', 'wiql', { type: 'wiql', wiql: 'SELECT 1' });
    const h2 = computeSourceHash('P', 'wiql', { type: 'wiql', wiql: 'SELECT 2' });
    expect(h1).not.toBe(h2);
  });

  it('produces stable hash regardless of object key order', () => {
    const h1 = computeSourceHash('P', 'fieldFilters', { b: 2, a: 1 });
    const h2 = computeSourceHash('P', 'fieldFilters', { a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('returns a 16-character base64url string', () => {
    const h = computeSourceHash('P', 'wiql', {});
    expect(typeof h).toBe('string');
    expect(h).toHaveLength(16);
    expect(/^[A-Za-z0-9_-]+$/.test(h)).toBe(true);
  });
});
