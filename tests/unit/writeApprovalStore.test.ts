import { describe, it, expect, vi } from 'vitest';
import type { Collection } from 'mongodb';
import {
  WriteApprovalStore,
  type WriteApprovalDocument,
} from '../../src/approvals/writeApprovalStore.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const logger = createSilentLogger();

function makeApprovalDoc(
  overrides: Partial<WriteApprovalDocument> = {},
): WriteApprovalDocument {
  const now = new Date();
  return {
    approvalId: 'test-approval-id',
    appUserId: 'alice@example.com',
    requestId: 'test-request-id',
    operation: 'create_work_items',
    project: 'MyProject',
    workItemType: 'Task',
    normalizedPayload: [{ title: 'Test item' }],
    payloadHash: 'abc123hash',
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 600_000),
    ...overrides,
  };
}

function makeCollection(
  docs: WriteApprovalDocument[] = [],
): Collection<WriteApprovalDocument> {
  const map = new Map(docs.map((d) => [d.approvalId, { ...d }]));
  return {
    createIndex: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockImplementation(async (doc: WriteApprovalDocument) => {
      map.set(doc.approvalId, { ...doc });
      return { acknowledged: true };
    }),
    findOne: vi.fn().mockImplementation(
      async ({ approvalId }: { approvalId: string }) => map.get(approvalId) ?? null,
    ),
    updateOne: vi.fn().mockImplementation(
      async (
        filter: { approvalId: string },
        update: { $set: Partial<WriteApprovalDocument> },
      ) => {
        const doc = map.get(filter.approvalId);
        if (doc) Object.assign(doc, update.$set);
        return { matchedCount: doc ? 1 : 0 };
      },
    ),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    findOneAndUpdate: vi.fn().mockImplementation(
      async (
        filter: Record<string, unknown>,
        update: { $set: Partial<WriteApprovalDocument> },
        _options: unknown,
      ) => {
        const approvalId = filter['approvalId'] as string;
        const appUserId = filter['appUserId'] as string;
        const statusFilter = filter['status'] as string;
        const expiresGt = (filter['expiresAt'] as Record<string, Date> | undefined)?.$gt;

        const doc = map.get(approvalId);
        if (!doc) return null;
        if (doc.appUserId !== appUserId) return null;
        if (doc.status !== statusFilter) return null;
        if (expiresGt && doc.expiresAt <= expiresGt) return null;

        Object.assign(doc, update.$set);
        return { ...doc };
      },
    ),
    find: vi.fn().mockImplementation(
      (filter: Record<string, unknown>) => {
        const statusFilter = filter['status'] as string;
        const startedAtFilter = (filter['executionStartedAt'] as Record<string, Date> | undefined)?.$lt;
        const results = [...map.values()].filter((doc) => {
          if (doc.status !== statusFilter) return false;
          if (startedAtFilter && doc.executionStartedAt && doc.executionStartedAt >= startedAtFilter) return false;
          if (startedAtFilter && !doc.executionStartedAt) return false;
          return true;
        });
        return { toArray: async () => results.map((d) => ({ ...d })) };
      },
    ),
  } as unknown as Collection<WriteApprovalDocument>;
}

function makeStore(docs: WriteApprovalDocument[] = []) {
  const col = makeCollection(docs);
  const store = new WriteApprovalStore(col, logger);
  return { store, col };
}

// ── ensureIndexes ─────────────────────────────────────────────────────────────

describe('WriteApprovalStore — ensureIndexes', () => {
  it('creates three indexes', async () => {
    const { store, col } = makeStore();
    await store.ensureIndexes();
    expect(vi.mocked(col.createIndex)).toHaveBeenCalledTimes(3);
  });
});

// ── createApproval ────────────────────────────────────────────────────────────

describe('WriteApprovalStore — createApproval', () => {
  it('inserts document and returns it', async () => {
    const { store, col } = makeStore();
    const doc = makeApprovalDoc();
    const result = await store.createApproval(doc);
    expect(result.approvalId).toBe('test-approval-id');
    expect(vi.mocked(col.insertOne)).toHaveBeenCalledOnce();
  });

  it('does not store PAT or Authorization in approval', async () => {
    const { store } = makeStore();
    const doc = makeApprovalDoc();
    const result = await store.createApproval(doc);
    const json = JSON.stringify(result);
    expect(json.toLowerCase()).not.toContain('pat');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('encryptedPat');
  });
});

// ── findApproval ──────────────────────────────────────────────────────────────

describe('WriteApprovalStore — findApproval', () => {
  it('returns approval when found', async () => {
    const doc = makeApprovalDoc();
    const { store } = makeStore([doc]);
    const result = await store.findApproval('test-approval-id');
    expect(result?.approvalId).toBe('test-approval-id');
  });

  it('returns null when not found', async () => {
    const { store } = makeStore();
    const result = await store.findApproval('nonexistent-id');
    expect(result).toBeNull();
  });
});

// ── markTerminal ──────────────────────────────────────────────────────────────

describe('WriteApprovalStore — markTerminal', () => {
  it('marks approval used_success', async () => {
    const doc = makeApprovalDoc({ status: 'pending' });
    const { store, col } = makeStore([doc]);
    await store.markTerminal('test-approval-id', 'used_success');
    expect(vi.mocked(col.updateOne)).toHaveBeenCalledWith(
      { approvalId: 'test-approval-id' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'used_success' }) }),
    );
  });

  it('marks approval used_partial_failure and stores partialCreatedIds', async () => {
    const doc = makeApprovalDoc({ status: 'pending' });
    const { store, col } = makeStore([doc]);
    await store.markTerminal('test-approval-id', 'used_partial_failure', [101, 102]);
    expect(vi.mocked(col.updateOne)).toHaveBeenCalledWith(
      { approvalId: 'test-approval-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'used_partial_failure',
          partialCreatedIds: [101, 102],
        }),
      }),
    );
  });

  it('marks approval used_failed_after_attempt', async () => {
    const doc = makeApprovalDoc({ status: 'pending' });
    const { store, col } = makeStore([doc]);
    await store.markTerminal('test-approval-id', 'used_failed_after_attempt');
    expect(vi.mocked(col.updateOne)).toHaveBeenCalledWith(
      { approvalId: 'test-approval-id' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'used_failed_after_attempt' }),
      }),
    );
  });
});

// ── expireStale ───────────────────────────────────────────────────────────────

describe('WriteApprovalStore — expireStale', () => {
  it('does not throw when collection is empty', async () => {
    const { store } = makeStore();
    await expect(store.expireStale()).resolves.not.toThrow();
  });
});

// ── static helpers ────────────────────────────────────────────────────────────

describe('WriteApprovalStore — static helpers', () => {
  it('isExpired returns true when expiresAt is in the past', () => {
    expect(
      WriteApprovalStore.isExpired({ expiresAt: new Date(Date.now() - 1000) }),
    ).toBe(true);
  });

  it('isExpired returns false when expiresAt is in the future', () => {
    expect(
      WriteApprovalStore.isExpired({ expiresAt: new Date(Date.now() + 600_000) }),
    ).toBe(false);
  });

  it('isTerminal returns false for pending', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'pending' })).toBe(false);
  });

  it('isTerminal returns false for expired', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'expired' })).toBe(false);
  });

  it('isTerminal returns true for used_success', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'used_success' })).toBe(true);
  });

  it('isTerminal returns true for used_partial_failure', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'used_partial_failure' })).toBe(true);
  });

  it('isTerminal returns true for used_failed_after_attempt', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'used_failed_after_attempt' })).toBe(true);
  });

  it('isTerminal returns false for executing', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'executing' })).toBe(false);
  });

  it('isTerminal returns true for needs_manual_review', () => {
    expect(WriteApprovalStore.isTerminal({ status: 'needs_manual_review' })).toBe(true);
  });

  it('belongsToUser returns true for matching appUserId', () => {
    expect(
      WriteApprovalStore.belongsToUser({ appUserId: 'alice@example.com' }, 'alice@example.com'),
    ).toBe(true);
  });

  it('belongsToUser returns false for different appUserId', () => {
    expect(
      WriteApprovalStore.belongsToUser({ appUserId: 'alice@example.com' }, 'bob@example.com'),
    ).toBe(false);
  });
});

// ── buildDocument ─────────────────────────────────────────────────────────────

describe('WriteApprovalStore — buildDocument', () => {
  it('generates a valid pending document', () => {
    const doc = WriteApprovalStore.buildDocument({
      appUserId: 'alice@example.com',
      requestId: 'req-1',
      project: 'MyProject',
      workItemType: 'Task',
      normalizedPayload: [{ title: 'My task' }],
      ttlSeconds: 600,
    });
    expect(doc.status).toBe('pending');
    expect(doc.approvalId).toBeTruthy();
    expect(doc.payloadHash).toBeTruthy();
    expect(doc.expiresAt.getTime()).toBeGreaterThan(doc.createdAt.getTime());
  });

  it('approval cannot be re-executed (isTerminal rejects non-pending)', () => {
    const terminalStatuses: Array<WriteApprovalDocument['status']> = [
      'used_success',
      'used_partial_failure',
      'used_failed_after_attempt',
      'needs_manual_review',
    ];
    for (const status of terminalStatuses) {
      const doc = makeApprovalDoc({ status });
      expect(WriteApprovalStore.isTerminal(doc)).toBe(true);
    }
  });
});

// ── claimForExecution ─────────────────────────────────────────────────────────

describe('WriteApprovalStore — claimForExecution', () => {
  it('transitions pending → executing and returns claimed doc', async () => {
    const doc = makeApprovalDoc({ status: 'pending' });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-exec-1');
    expect(result).not.toBeNull();
    expect(result?.status).toBe('executing');
    expect(result?.executionRequestId).toBe('req-exec-1');
    expect(result?.executionStartedAt).toBeInstanceOf(Date);
  });

  it('returns null when approval not found', async () => {
    const { store } = makeStore();
    const result = await store.claimForExecution('nonexistent', 'alice@example.com', 'req-1');
    expect(result).toBeNull();
  });

  it('returns null when appUserId does not match (wrong user)', async () => {
    const doc = makeApprovalDoc({ appUserId: 'alice@example.com', status: 'pending' });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'bob@example.com', 'req-1');
    expect(result).toBeNull();
  });

  it('returns null when approval is expired', async () => {
    const doc = makeApprovalDoc({ expiresAt: new Date(Date.now() - 1000) });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-1');
    expect(result).toBeNull();
  });

  it('returns null when approval is already executing (concurrent claim)', async () => {
    const doc = makeApprovalDoc({ status: 'executing' });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-2');
    expect(result).toBeNull();
  });

  it('returns null when approval is already terminal (used_success)', async () => {
    const doc = makeApprovalDoc({ status: 'used_success' });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-1');
    expect(result).toBeNull();
  });

  it('returns null when approval is needs_manual_review', async () => {
    const doc = makeApprovalDoc({ status: 'needs_manual_review' });
    const { store } = makeStore([doc]);
    const result = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-1');
    expect(result).toBeNull();
  });

  it('simulates two concurrent claims: first wins, second returns null', async () => {
    const doc = makeApprovalDoc({ status: 'pending' });
    const { store } = makeStore([doc]);
    const first = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-A');
    expect(first?.status).toBe('executing');
    const second = await store.claimForExecution('test-approval-id', 'alice@example.com', 'req-B');
    expect(second).toBeNull();
  });
});

// ── listStaleExecuting ────────────────────────────────────────────────────────

describe('WriteApprovalStore — listStaleExecuting', () => {
  it('returns executing docs older than threshold', async () => {
    const stale = makeApprovalDoc({
      approvalId: 'stale-1',
      status: 'executing',
      executionStartedAt: new Date(Date.now() - 1_000_000),
    });
    const fresh = makeApprovalDoc({
      approvalId: 'fresh-1',
      status: 'executing',
      executionStartedAt: new Date(),
    });
    const { store } = makeStore([stale, fresh]);
    const results = await store.listStaleExecuting(900);
    expect(results.some((d) => d.approvalId === 'stale-1')).toBe(true);
    expect(results.some((d) => d.approvalId === 'fresh-1')).toBe(false);
  });

  it('returns empty array when no stale executing approvals', async () => {
    const { store } = makeStore();
    const results = await store.listStaleExecuting(900);
    expect(results).toHaveLength(0);
  });
});
