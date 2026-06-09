import { describe, it, expect, vi } from 'vitest';
import { requestContextStorage } from '../../src/utils/requestContext.js';
import type { AppConfig } from '../../src/config/config.js';
import type { WriteApprovalStore, WriteApprovalDocument } from '../../src/approvals/writeApprovalStore.js';
import type { WorkItemCreateClient, CreatedWorkItem } from '../../src/ado/workItemCreateClient.js';
import { createConfirmHandler } from '../../src/mcp/tools/writeTools.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import type { AuthContext } from '../../src/auth/authContext.js';
import * as authContextModule from '../../src/auth/authContext.js';

const logger = createSilentLogger();

const BASE_CONFIG = {
  adoOrgUrl: 'https://tfs.example.local/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoAuthMode: 'trusted_user_header',
  adoAllowPatInToolArgs: false,
  adoReadOnly: false,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
  adoPageSizeDefault: 50,
  adoPageSizeMax: 200,
  adoScopeCacheTtlMs: 600000,
  adoScopeCacheMaxEntries: 50,
  adoBatchSize: 200,
  adoReviewExtraFields: [],
  adoTraceabilityLinkTokens: [],
  logLevel: 'silent',
  adoWriteMaxItemsPerApproval: 5,
  adoWriteApprovalTtlSeconds: 600,
  adoWriteApprovalsCollection: 'ado_write_approvals',
  adoWriteExecutionStaleSeconds: 900,
  adoAllowedWorkItemTypes: [] as string[],
  adoAllowedProjects: [] as string[],
  adoAllowedAreaPathPrefixes: [] as string[],
  adoAllowedIterationPathPrefixes: [] as string[],
} as unknown as AppConfig;

const READ_ONLY_CONFIG = { ...BASE_CONFIG, adoReadOnly: true } as AppConfig;

const ALICE_AUTH: AuthContext = {
  mode: 'trusted_user_header',
  pat: 'secret-pat-alice',
  source: 'trusted_header',
  appUserId: 'alice@example.com',
};

const ALICE_CTX = {
  requestId: 'req-confirm-1',
  toolName: 'ado_confirm_create_work_items',
  appUserId: 'alice@example.com',
  resolvedAuth: ALICE_AUTH,
};

async function withCtx<T>(ctx: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(ctx as never, fn);
}

/** Build a document as it would appear AFTER claimForExecution succeeds (status=executing). */
function makeClaimedApproval(overrides: Partial<WriteApprovalDocument> = {}): WriteApprovalDocument {
  return {
    approvalId: 'approval-abc',
    appUserId: 'alice@example.com',
    requestId: 'req-1',
    operation: 'create_work_items',
    project: 'MyProject',
    workItemType: 'Task',
    normalizedPayload: [{ title: 'New task' }],
    payloadHash: 'abc123',
    status: 'executing',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    executionStartedAt: new Date(),
    executionRequestId: 'req-confirm-1',
    ...overrides,
  };
}

/**
 * makeStore builds a mock WriteApprovalStore.
 * claimResult: what claimForExecution returns.
 *   - Pass a doc → claim succeeds
 *   - Pass null → claim fails (not found / wrong user / expired / executing / terminal)
 */
function makeStore(claimResult: WriteApprovalDocument | null = null): WriteApprovalStore {
  return {
    createApproval: vi.fn(),
    findApproval: vi.fn().mockResolvedValue(null),
    claimForExecution: vi.fn().mockResolvedValue(claimResult),
    markTerminal: vi.fn().mockResolvedValue(undefined),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    expireStale: vi.fn().mockResolvedValue(undefined),
    listStaleExecuting: vi.fn().mockResolvedValue([]),
  } as unknown as WriteApprovalStore;
}

function makeCreateClient(items: CreatedWorkItem[] = []): WorkItemCreateClient {
  let idx = 0;
  return {
    createOne: vi.fn().mockImplementation(async () => items[idx++] ?? { id: 9999 }),
  } as unknown as WorkItemCreateClient;
}

function withAliceAuth<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(authContextModule, 'resolveAuthContext').mockReturnValue(ALICE_AUTH);
  return fn().finally(() => spy.mockRestore());
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('confirmHandler — happy path', () => {
  it('creates work items and returns IDs after successful claim', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient([{ id: 42, webUrl: 'https://ado/42' }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.createdWorkItemIds).toContain(42);
    expect(parsed.terminalStatus).toBe('used_success');
  });

  it('marks approval used_success after full success', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith('approval-abc', 'used_success', undefined);
  });

  it('confirm output contains no PAT or encryptedPat', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    const text = result.content[0].text;
    expect(text).not.toContain('secret-pat-alice');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('encryptedPat');
  });

  it('multi-item: marks used_success when all created', async () => {
    const claimed = makeClaimedApproval({
      normalizedPayload: [{ title: 'Task 1' }, { title: 'Task 2' }],
    });
    const store = makeStore(claimed);
    const client = makeCreateClient([{ id: 10 }, { id: 11 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.createdWorkItemIds).toEqual([10, 11]);
    expect(parsed.terminalStatus).toBe('used_success');
    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith('approval-abc', 'used_success', undefined);
  });

  it('uses only stored payload — ignores any extra args', async () => {
    const claimed = makeClaimedApproval({ workItemType: 'Task' });
    const store = makeStore(claimed);
    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.workItemType).toBe('Task');
    expect(vi.mocked(client.createOne)).toHaveBeenCalledWith(
      'MyProject', 'Task', { title: 'New task' }, ALICE_AUTH,
    );
  });
});

// ── Partial failure ───────────────────────────────────────────────────────────

describe('confirmHandler — partial failure', () => {
  it('marks used_partial_failure when first item created, second fails', async () => {
    const claimed = makeClaimedApproval({
      normalizedPayload: [{ title: 'Task 1' }, { title: 'Task 2' }],
    });
    const store = makeStore(claimed);
    const client = makeCreateClient();
    vi.mocked(client.createOne)
      .mockResolvedValueOnce({ id: 10 })
      .mockRejectedValueOnce(new Error('ADO 500'));
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.terminalStatus).toBe('used_partial_failure');
    expect(parsed.partialCreatedWorkItemIds).toContain(10);
    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith(
      'approval-abc', 'used_partial_failure', [10],
    );
  });

  it('marks used_failed_after_attempt when first item fails (none created)', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient();
    vi.mocked(client.createOne).mockRejectedValue(new Error('ADO 401 Unauthorized'));
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.terminalStatus).toBe('used_failed_after_attempt');
    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith(
      'approval-abc', 'used_failed_after_attempt', undefined,
    );
  });

  it('never leaves approval in executing state after write attempt', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient();
    vi.mocked(client.createOne).mockRejectedValue(new Error('ADO error'));
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(vi.mocked(store.markTerminal)).toHaveBeenCalled();
    const [, status] = vi.mocked(store.markTerminal).mock.calls[0];
    expect(status).not.toBe('pending');
    expect(status).not.toBe('executing');
  });
});

// ── Claim-based safety ────────────────────────────────────────────────────────

describe('confirmHandler — claim-based safety', () => {
  it('fails when ADO_READ_ONLY=true — claimForExecution never called', async () => {
    const store = makeStore(makeClaimedApproval());
    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(READ_ONLY_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('read-only');
    expect(vi.mocked(store.claimForExecution)).not.toHaveBeenCalled();
    expect(vi.mocked(client.createOne)).not.toHaveBeenCalled();
  });

  it('fails when no appUserId — claimForExecution never called', async () => {
    const store = makeStore(makeClaimedApproval());
    const client = makeCreateClient();
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const ctxNoUser = { requestId: 'r', toolName: 't', appUserId: undefined };
    const result = await requestContextStorage.run(ctxNoUser as never, () =>
      handler({ approvalId: 'approval-abc' }),
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(store.claimForExecution)).not.toHaveBeenCalled();
    expect(vi.mocked(client.createOne)).not.toHaveBeenCalled();
  });

  it('returns generic error when claim returns null (no state leakage)', async () => {
    const store = makeStore(null);
    const client = makeCreateClient();
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
    expect(vi.mocked(client.createOne)).not.toHaveBeenCalled();
    expect(vi.mocked(store.markTerminal)).not.toHaveBeenCalled();
  });

  it('generic error does not expose user identity', async () => {
    const store = makeStore(null);
    const client = makeCreateClient();
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(result.content[0].text).not.toContain('alice');
    expect(result.content[0].text).not.toContain('bob');
  });

  it('two concurrent confirms: first wins, second gets null from claim and errors', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(null);
    vi.mocked(store.claimForExecution)
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(null);

    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const firstResult = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );
    const secondResult = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    expect(firstResult.isError).toBeFalsy();
    expect(secondResult.isError).toBe(true);
    expect(secondResult.content[0].text).toContain('not available');
  });

  it('marks needs_manual_review when auth resolution fails after successful claim', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient();
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    vi.spyOn(authContextModule, 'resolveAuthContext').mockImplementationOnce(() => {
      throw new Error('No credential');
    });

    const result = await withCtx(ALICE_CTX, () =>
      handler({ approvalId: 'approval-abc' }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('manual review');
    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith(
      'approval-abc', 'needs_manual_review',
    );
    expect(vi.mocked(client.createOne)).not.toHaveBeenCalled();
  });

  it('markTerminal failure is swallowed — result still returned to caller', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    vi.mocked(store.markTerminal).mockRejectedValue(new Error('mongo gone'));
    const client = makeCreateClient([{ id: 42 }]);
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    const result = await withAliceAuth(() =>
      withCtx(ALICE_CTX, () => handler({ approvalId: 'approval-abc' })),
    );

    // markTerminal threw but result is still success — caller gets the IDs
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.createdWorkItemIds).toContain(42);
  });

  it('marks needs_manual_review when PAT is null after successful claim', async () => {
    const claimed = makeClaimedApproval();
    const store = makeStore(claimed);
    const client = makeCreateClient();
    const handler = createConfirmHandler(BASE_CONFIG, store, client, logger);

    vi.spyOn(authContextModule, 'resolveAuthContext').mockReturnValueOnce({
      mode: 'trusted_user_header',
      pat: undefined,
      source: 'trusted_header',
    });

    const result = await withCtx(ALICE_CTX, () =>
      handler({ approvalId: 'approval-abc' }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('manual review');
    expect(vi.mocked(store.markTerminal)).toHaveBeenCalledWith(
      'approval-abc', 'needs_manual_review',
    );
    expect(vi.mocked(client.createOne)).not.toHaveBeenCalled();
  });
});
