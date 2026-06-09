import { describe, it, expect, vi } from 'vitest';
import { requestContextStorage } from '../../src/utils/requestContext.js';
import type { AppConfig } from '../../src/config/config.js';
import type { WriteApprovalStore, WriteApprovalDocument } from '../../src/approvals/writeApprovalStore.js';
import { createPreviewHandler } from '../../src/mcp/tools/writeTools.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const logger = createSilentLogger();

const BASE_CONFIG = {
  adoOrgUrl: 'https://tfs.example.local/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
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
  adoReviewExtraFields: [],
  adoTraceabilityLinkTokens: [],
  logLevel: 'silent',
  adoWriteMaxItemsPerApproval: 5,
  adoWriteApprovalTtlSeconds: 600,
  adoWriteApprovalsCollection: 'ado_write_approvals',
  adoAllowedWorkItemTypes: [] as string[],
  adoAllowedProjects: [] as string[],
  adoAllowedAreaPathPrefixes: [] as string[],
  adoAllowedIterationPathPrefixes: [] as string[],
} as unknown as AppConfig;

const ALICE_CTX = {
  requestId: 'req-1',
  toolName: 'ado_preview_create_work_items',
  appUserId: 'alice@example.com',
  resolvedAuth: {
    mode: 'trusted_user_header' as const,
    pat: 'super-secret-pat-value',
    source: 'trusted_header' as const,
    appUserId: 'alice@example.com',
  } as AuthContext,
};

async function withCtx<T>(ctx: typeof ALICE_CTX | Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(ctx as never, fn);
}

function makeApprovalStore(): WriteApprovalStore {
  const docs = new Map<string, WriteApprovalDocument>();
  return {
    createApproval: vi.fn().mockImplementation(async (doc: WriteApprovalDocument) => {
      docs.set(doc.approvalId, { ...doc });
      return doc;
    }),
    findApproval: vi.fn().mockImplementation(async (id: string) => docs.get(id) ?? null),
    markTerminal: vi.fn().mockResolvedValue(undefined),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    expireStale: vi.fn().mockResolvedValue(undefined),
  } as unknown as WriteApprovalStore;
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('previewHandler — happy path', () => {
  it('returns approvalId without creating work items in ADO', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'MyProject', workItemType: 'Task', items: [{ title: 'New task' }] }),
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.approvalId).toBeTruthy();
    expect(parsed.operation).toBe('create_work_items');
    expect(parsed.noAdoWriteOccurred).toBe(true);
    expect(vi.mocked(store.createApproval)).toHaveBeenCalledOnce();
  });

  it('preview output contains no PAT or Authorization header', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'MyProject', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    const text = result.content[0].text;
    expect(text).not.toContain('super-secret-pat-value');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('encryptedPat');
  });

  it('stores normalized payload with trimmed title', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    await withCtx(ALICE_CTX, () =>
      handler({ project: 'MyProject', workItemType: 'Task', items: [{ title: '  My Task  ' }] }),
    );

    const storedDoc = vi.mocked(store.createApproval).mock.calls[0][0] as WriteApprovalDocument;
    expect(storedDoc.normalizedPayload[0].title).toBe('My Task');
  });

  it('stores correct project and workItemType in approval doc', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    await withCtx(ALICE_CTX, () =>
      handler({ project: 'Alpha', workItemType: 'Bug', items: [{ title: 'T' }] }),
    );

    const storedDoc = vi.mocked(store.createApproval).mock.calls[0][0] as WriteApprovalDocument;
    expect(storedDoc.project).toBe('Alpha');
    expect(storedDoc.workItemType).toBe('Bug');
    expect(storedDoc.appUserId).toBe('alice@example.com');
  });

  it('returns nextStep instruction with approvalId', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nextStep).toContain(parsed.approvalId);
  });
});

// ── Validation failures ───────────────────────────────────────────────────────

describe('previewHandler — validation failures', () => {
  it('rejects empty items array', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [] }),
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(store.createApproval)).not.toHaveBeenCalled();
  });

  it('rejects items exceeding max count', async () => {
    const store = makeApprovalStore();
    const config = { ...BASE_CONFIG, adoWriteMaxItemsPerApproval: 2 } as AppConfig;
    const handler = createPreviewHandler(config, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('2');
  });

  it('rejects empty title', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: '' }] }),
    );

    expect(result.isError).toBe(true);
  });

  it('rejects disallowed work item type when allowlist set', async () => {
    const store = makeApprovalStore();
    const config = { ...BASE_CONFIG, adoAllowedWorkItemTypes: ['Bug'] } as AppConfig;
    const handler = createPreviewHandler(config, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('work item type');
  });

  it('allows work item type when allowlist is empty (all types allowed)', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger); // adoAllowedWorkItemTypes: []

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    expect(result.isError).toBeFalsy();
  });

  it('rejects disallowed project when allowlist set', async () => {
    const store = makeApprovalStore();
    const config = { ...BASE_CONFIG, adoAllowedProjects: ['AllowedProject'] } as AppConfig;
    const handler = createPreviewHandler(config, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'ForbiddenProject', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('project');
  });

  it('rejects areaPath not matching prefix allowlist', async () => {
    const store = makeApprovalStore();
    const config = { ...BASE_CONFIG, adoAllowedAreaPathPrefixes: ['AllowedProject\\Team'] } as AppConfig;
    const handler = createPreviewHandler(config, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T', areaPath: 'OtherProject\\Team' }] }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain('areapath');
  });

  it('fails with isError when no appUserId in context', async () => {
    const store = makeApprovalStore();
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const ctxNoUser = { requestId: 'r', toolName: 't', appUserId: undefined };
    const result = await requestContextStorage.run(ctxNoUser as never, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    expect(result.isError).toBe(true);
    expect(vi.mocked(store.createApproval)).not.toHaveBeenCalled();
  });

  it('returns error when store.createApproval throws', async () => {
    const store = makeApprovalStore();
    vi.mocked(store.createApproval).mockRejectedValueOnce(new Error('MongoDB unavailable'));
    const handler = createPreviewHandler(BASE_CONFIG, store, logger);

    const result = await withCtx(ALICE_CTX, () =>
      handler({ project: 'P', workItemType: 'Task', items: [{ title: 'T' }] }),
    );

    expect(result.isError).toBe(true);
  });
});
