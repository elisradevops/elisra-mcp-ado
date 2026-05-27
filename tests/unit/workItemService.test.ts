import { describe, it, expect, vi } from 'vitest';
import { WorkItemService, toCompactRecord, groupByFields, extractDisplayName } from '../../src/services/workItemService.js';
import type { IWorkItemsClient } from '../../src/ado/workItemsClient.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import type { AuthContext } from '../../src/auth/authContext.js';
import type { AppConfig } from '../../src/config/config.js';

const mockAuth: AuthContext = { mode: 'per_request_pat', pat: 'test' };

const baseConfig = {
  adoBatchSize: 200,
  adoOrgUrl: 'https://tfs.example.local/tfs/Collection',
} as unknown as AppConfig;

function makeItem(id: number, overrides: Record<string, unknown> = {}): AdoWorkItem {
  return {
    id,
    fields: {
      'System.Id': id,
      'System.Title': `Item ${id}`,
      'System.WorkItemType': 'Requirement',
      'System.State': 'Active',
      'System.AreaPath': 'Project\\Area',
      'System.IterationPath': 'Project\\Sprint 1',
      'System.AssignedTo': { displayName: 'Alice', id: 'u1' },
      'System.ChangedDate': '2025-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

function makeClient(items: AdoWorkItem[]): IWorkItemsClient {
  return {
    fetchBatch: vi.fn().mockResolvedValue(items),
    fetchSingle: vi.fn().mockResolvedValue(items[0]),
  };
}

describe('WorkItemService.fetchMany', () => {
  it('returns empty array for empty IDs', async () => {
    const client = makeClient([]);
    const svc = new WorkItemService(client, baseConfig);
    expect(await svc.fetchMany([], mockAuth)).toEqual([]);
    expect(client.fetchBatch).not.toHaveBeenCalled();
  });

  it('passes IDs to fetchBatch', async () => {
    const items = [makeItem(1), makeItem(2)];
    const client = makeClient(items);
    const svc = new WorkItemService(client, baseConfig);
    const result = await svc.fetchMany([1, 2], mockAuth);
    expect(result).toHaveLength(2);
    expect(client.fetchBatch).toHaveBeenCalledWith([1, 2], mockAuth, undefined, undefined, undefined, undefined);
  });

  it('chunks at batchSize', async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem(i + 1));
    const client = makeClient(items);
    const smallBatchConfig = { ...baseConfig, adoBatchSize: 2 } as AppConfig;
    const svc = new WorkItemService(client, smallBatchConfig);
    await svc.fetchMany([1, 2, 3, 4, 5], mockAuth);
    expect(client.fetchBatch).toHaveBeenCalledTimes(3); // batches: [1,2], [3,4], [5]
  });

  it('caps batchSize at 200 regardless of config', async () => {
    const client = makeClient([]);
    const bigBatchConfig = { ...baseConfig, adoBatchSize: 9999 } as AppConfig;
    const svc = new WorkItemService(client, bigBatchConfig);
    // 201 IDs should still produce 2 batches (200 + 1)
    await svc.fetchMany(Array.from({ length: 201 }, (_, i) => i + 1), mockAuth);
    expect(client.fetchBatch).toHaveBeenCalledTimes(2);
    const firstCall = (client.fetchBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toHaveLength(200);
  });

  it('passes fields option to fetchBatch', async () => {
    const client = makeClient([makeItem(1)]);
    const svc = new WorkItemService(client, baseConfig);
    await svc.fetchMany([1], mockAuth, { fields: ['System.Id', 'System.Title'] });
    expect(client.fetchBatch).toHaveBeenCalledWith(
      [1], mockAuth, ['System.Id', 'System.Title'], undefined, undefined, undefined
    );
  });

  it('passes expand option to fetchBatch', async () => {
    const client = makeClient([makeItem(1)]);
    const svc = new WorkItemService(client, baseConfig);
    await svc.fetchMany([1], mockAuth, { expand: 'relations' });
    expect(client.fetchBatch).toHaveBeenCalledWith([1], mockAuth, undefined, 'relations', undefined, undefined);
  });
});

describe('WorkItemService.fetchCompact', () => {
  it('passes COMPACT_FIELDS to fetchBatch', async () => {
    const client = makeClient([makeItem(1)]);
    const svc = new WorkItemService(client, baseConfig);
    await svc.fetchCompact([1], mockAuth);
    const call = (client.fetchBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toContain('System.Id');
    expect(call[2]).toContain('System.Title');
    expect(call[2]).toContain('System.WorkItemType');
  });
});

describe('WorkItemService.fetchWithRelations', () => {
  it('passes expand=relations', async () => {
    const client = makeClient([makeItem(1)]);
    const svc = new WorkItemService(client, baseConfig);
    await svc.fetchWithRelations([1], mockAuth);
    const call = (client.fetchBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3]).toBe('relations');
  });
});

describe('toCompactRecord', () => {
  it('extracts known fields', () => {
    const item = makeItem(42);
    const rec = toCompactRecord(item);
    expect(rec.id).toBe(42);
    expect(rec.title).toBe('Item 42');
    expect(rec.workItemType).toBe('Requirement');
    expect(rec.state).toBe('Active');
    expect(rec.assignedTo).toBe('Alice');
  });

  it('extracts displayName from identity object', () => {
    const item = makeItem(1, { 'System.AssignedTo': { displayName: 'Bob', id: 'u2' } });
    expect(toCompactRecord(item).assignedTo).toBe('Bob');
  });

  it('handles missing AssignedTo', () => {
    const item = makeItem(1, { 'System.AssignedTo': null });
    expect(toCompactRecord(item).assignedTo).toBeUndefined();
  });

  it('handles string AssignedTo', () => {
    const item = makeItem(1, { 'System.AssignedTo': 'charlie@example.com' });
    expect(toCompactRecord(item).assignedTo).toBe('charlie@example.com');
  });
});

describe('extractDisplayName', () => {
  it('returns undefined for null/undefined', () => {
    expect(extractDisplayName(null)).toBeUndefined();
    expect(extractDisplayName(undefined)).toBeUndefined();
  });
  it('returns string as-is', () => {
    expect(extractDisplayName('Alice')).toBe('Alice');
  });
  it('extracts displayName from object', () => {
    expect(extractDisplayName({ displayName: 'Bob', id: 'x' })).toBe('Bob');
  });
  it('stringifies non-object', () => {
    expect(extractDisplayName(42)).toBe('42');
  });
});

describe('groupByFields', () => {
  const items = [
    makeItem(1, { 'System.WorkItemType': 'Requirement', 'System.State': 'Active' }),
    makeItem(2, { 'System.WorkItemType': 'Requirement', 'System.State': 'Active' }),
    makeItem(3, { 'System.WorkItemType': 'Bug', 'System.State': 'Closed' }),
    makeItem(4, { 'System.WorkItemType': 'Bug', 'System.State': 'Active' }),
    makeItem(5, { 'System.WorkItemType': 'Bug', 'System.State': 'Active' }),
  ];

  it('groups by single field', () => {
    const result = groupByFields(items, ['System.WorkItemType']);
    expect(result).toHaveLength(1);
    const buckets = result[0].buckets;
    const bug = buckets.find((b) => b.value === 'Bug')!;
    const req = buckets.find((b) => b.value === 'Requirement')!;
    expect(bug.count).toBe(3);
    expect(req.count).toBe(2);
  });

  it('sorts buckets by count descending', () => {
    const result = groupByFields(items, ['System.WorkItemType']);
    expect(result[0].buckets[0].value).toBe('Bug'); // 3 > 2
  });

  it('groups by multiple fields', () => {
    const result = groupByFields(items, ['System.WorkItemType', 'System.State']);
    expect(result).toHaveLength(2);
    expect(result[0].field).toBe('System.WorkItemType');
    expect(result[1].field).toBe('System.State');
  });

  it('includes sampleIds (up to 5)', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeItem(i + 1, { 'System.State': 'Active' }));
    const result = groupByFields(many, ['System.State']);
    const activeBucket = result[0].buckets.find((b) => b.value === 'Active')!;
    expect(activeBucket.sampleIds).toHaveLength(5); // capped at 5
  });

  it('labels missing field values as (none)', () => {
    const itemNoState = { id: 99, fields: { 'System.State': undefined } } as unknown as AdoWorkItem;
    const result = groupByFields([itemNoState], ['System.State']);
    expect(result[0].buckets[0].value).toBe('(none)');
  });

  it('returns empty buckets for empty items', () => {
    const result = groupByFields([], ['System.WorkItemType']);
    expect(result[0].buckets).toHaveLength(0);
  });
});
