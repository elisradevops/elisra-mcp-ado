import { randomUUID, createHash } from 'node:crypto';

export interface SnapshotMeta {
  project: string | undefined;
  sourceType: string;
  sourceHash?: string;
}

export function computeSourceHash(project: string | undefined, sourceType: string, sourceArgs: unknown): string {
  const canonical = JSON.stringify({ p: project ?? null, t: sourceType, s: sourceArgs }, stableReplacer);
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 16);
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return value;
}

export interface Snapshot {
  ids: number[];
  meta: SnapshotMeta;
}

interface CacheEntry {
  ids: number[];
  meta: SnapshotMeta;
  createdAt: number;
}

export class ScopeSnapshotCache {
  private cache: Map<string, CacheEntry>;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries: number) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  put(ids: number[], meta: SnapshotMeta): string {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const snapshotId = randomUUID();
    this.cache.set(snapshotId, { ids, meta, createdAt: Date.now() });
    return snapshotId;
  }

  get(snapshotId: string): Snapshot | null {
    const entry = this.cache.get(snapshotId);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(snapshotId);
      return null;
    }

    // Bump LRU position: delete + re-set
    this.cache.delete(snapshotId);
    this.cache.set(snapshotId, entry);

    return { ids: entry.ids, meta: entry.meta };
  }
}

// ─── Cursor encoding helpers ──────────────────────────────────────────────────

export function encodeCursor(snapshotId: string, nextOffset: number): string {
  return Buffer.from(JSON.stringify({ s: snapshotId, o: nextOffset })).toString('base64url');
}

export function decodeCursor(cursor: string): { snapshotId: string; offset: number } | null {
  try {
    let normalized = cursor.trim();
    if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))) {
      normalized = normalized.slice(1, -1);
    }
    const json = Buffer.from(normalized, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)['s'] !== 'string' ||
      !Number.isFinite((parsed as Record<string, unknown>)['o'] as number)
    ) {
      return null;
    }
    const obj = parsed as { s: string; o: number };
    return { snapshotId: obj.s, offset: obj.o };
  } catch {
    return null;
  }
}
