import { describe, it, expect, vi } from 'vitest';
import { ReviewScopeResolver, AdoScopeError } from '../../src/services/reviewScopeResolver.js';
import type { IWiqlClient, WiqlResult } from '../../src/ado/wiqlClient.js';
import type { WorkItemService } from '../../src/services/workItemService.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import type { ReviewScope } from '../../src/domain/reviewScope.js';
import type { AppConfig } from '../../src/config/config.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const AUTH = { mode: 'per_request_pat' as const, pat: 'fakepatfakepatfakepatfakepatfakepatfakepatfakepatfakepat' };

const baseConfig: AppConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAuthMode: 'per_request_pat',
  adoReadOnly: true,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
  adoFullResponseMaxItems: 50,
  logLevel: 'silent' as unknown as AppConfig['logLevel'],
};

function makeWiqlClient(ids: number[] = [1, 2, 3]): IWiqlClient {
  return {
    execute: vi.fn().mockResolvedValue({ ids, totalMatched: ids.length, queryType: 'flat' } satisfies WiqlResult),
  };
}

function makeWorkItemService(itemsPerCall: AdoWorkItem[][] = [[]]): WorkItemService {
  let callIndex = 0;
  return {
    fetchWithRelations: vi.fn().mockImplementation(() => {
      const items = itemsPerCall[callIndex] ?? itemsPerCall[itemsPerCall.length - 1];
      callIndex++;
      return Promise.resolve(items);
    }),
    fetchMany: vi.fn().mockResolvedValue([]),
    fetchCompact: vi.fn().mockResolvedValue([]),
  } as unknown as WorkItemService;
}

function makeItem(id: number, relations: AdoWorkItem['relations'] = []): AdoWorkItem {
  return { id, fields: { 'System.Id': id }, relations };
}

function makeResolver(
  wiqlClient: IWiqlClient,
  configOverride?: Partial<AppConfig>,
  workItemService?: WorkItemService
): ReviewScopeResolver {
  return new ReviewScopeResolver(
    wiqlClient,
    { ...baseConfig, ...configOverride },
    createSilentLogger(),
    workItemService
  );
}

// ─── wiql source ──────────────────────────────────────────────────────────────

describe('ReviewScopeResolver — wiql source', () => {
  it('calls wiqlClient.execute and returns IDs', async () => {
    const client = makeWiqlClient([10, 20, 30]);
    const resolver = makeResolver(client);
    const scope: ReviewScope = {
      project: 'CUAS',
      auth: AUTH,
      source: { type: 'wiql', wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Requirement'" },
    };
    const result = await resolver.resolve(scope);
    expect(result.sourceType).toBe('wiql');
    expect(result.ids).toEqual([10, 20, 30]);
    expect(result.totalMatched).toBe(3);
    expect(result.project).toBe('CUAS');
    expect(result.warnings).toHaveLength(0);
  });

  it('passes project and auth to wiqlClient', async () => {
    const client = makeWiqlClient([1]);
    const resolver = makeResolver(client);
    const scope: ReviewScope = {
      project: 'MyProject',
      auth: AUTH,
      source: { type: 'wiql', wiql: 'SELECT [System.Id] FROM WorkItems' },
    };
    await resolver.resolve(scope);
    expect(client.execute).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'MyProject', auth: AUTH })
    );
  });

  it('throws PROJECT_REQUIRED when project is missing', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = {
      source: { type: 'wiql', wiql: 'SELECT [System.Id] FROM WorkItems' },
    };
    await expect(resolver.resolve(scope)).rejects.toMatchObject({
      code: 'PROJECT_REQUIRED',
      name: 'AdoScopeError',
    });
  });

  it('omits debugWiql when adoEnableDebugOutput=false', async () => {
    const resolver = makeResolver(makeWiqlClient(), { adoEnableDebugOutput: false });
    const wiql = 'SELECT [System.Id] FROM WorkItems';
    const scope: ReviewScope = { project: 'P', auth: AUTH, source: { type: 'wiql', wiql } };
    const result = await resolver.resolve(scope);
    expect(result.debugWiql).toBeUndefined();
  });

  it('includes debugWiql when adoEnableDebugOutput=true', async () => {
    const resolver = makeResolver(makeWiqlClient(), { adoEnableDebugOutput: true });
    const wiql = 'SELECT [System.Id] FROM WorkItems';
    const scope: ReviewScope = { project: 'P', auth: AUTH, source: { type: 'wiql', wiql } };
    const result = await resolver.resolve(scope);
    expect(result.debugWiql).toBe(wiql);
  });

  it('returns empty IDs when WIQL matches nothing', async () => {
    const resolver = makeResolver(makeWiqlClient([]));
    const scope: ReviewScope = { project: 'P', auth: AUTH, source: { type: 'wiql', wiql: 'SELECT [System.Id] FROM WorkItems WHERE [System.Id] = -1' } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toEqual([]);
    expect(result.totalMatched).toBe(0);
  });
});

// ─── ids source ───────────────────────────────────────────────────────────────

describe('ReviewScopeResolver — ids source', () => {
  it('returns provided IDs directly without network call', async () => {
    const client = makeWiqlClient();
    const resolver = makeResolver(client);
    const scope: ReviewScope = { source: { type: 'ids', ids: [5, 10, 15] } };
    const result = await resolver.resolve(scope);
    expect(result.sourceType).toBe('ids');
    expect(result.ids).toEqual([5, 10, 15]);
    expect(result.totalMatched).toBe(3);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('deduplicates IDs and emits warning', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'ids', ids: [1, 2, 1, 3, 2] } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toEqual([1, 2, 3]);
    expect(result.totalMatched).toBe(3);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('skips invalid IDs and emits warning', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'ids', ids: [1, -5, 0, 2] } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toEqual([1, 2]);
    expect(result.warnings.some((w) => w.includes('invalid'))).toBe(true);
  });

  it('throws when all IDs are invalid', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'ids', ids: [-1, 0] } };
    await expect(resolver.resolve(scope)).rejects.toThrow('no valid work item IDs');
  });

  it('does not require project', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'ids', ids: [42] } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toEqual([42]);
    expect(result.project).toBeUndefined();
  });
});

// ─── fieldFilters source ──────────────────────────────────────────────────────

describe('ReviewScopeResolver — fieldFilters source', () => {
  it('compiles filters to WIQL and executes', async () => {
    const client = makeWiqlClient([1, 2]);
    const resolver = makeResolver(client);
    const scope: ReviewScope = {
      project: 'MyProject',
      auth: AUTH,
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'System.WorkItemType', operator: '=', value: 'Requirement' }],
      },
    };
    const result = await resolver.resolve(scope);
    expect(result.sourceType).toBe('fieldFilters');
    expect(result.ids).toEqual([1, 2]);
    expect(client.execute).toHaveBeenCalledOnce();
    const call = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.wiql).toContain('[System.WorkItemType]');
    expect(call.wiql).toContain("'Requirement'");
    expect(call.project).toBe('MyProject');
  });

  it('throws PROJECT_REQUIRED when project is missing', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = {
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'System.State', operator: '=', value: 'Active' }],
      },
    };
    await expect(resolver.resolve(scope)).rejects.toMatchObject({ code: 'PROJECT_REQUIRED' });
  });

  it('includes debugWiql when adoEnableDebugOutput=true', async () => {
    const resolver = makeResolver(makeWiqlClient([1]), { adoEnableDebugOutput: true });
    const scope: ReviewScope = {
      project: 'P',
      auth: AUTH,
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'System.State', operator: '=', value: 'Active' }],
      },
    };
    const result = await resolver.resolve(scope);
    expect(result.debugWiql).toBeDefined();
    expect(result.debugWiql).toContain('[System.State]');
  });

  it('propagates compiler warnings for unknown fields when allowed', async () => {
    const resolver = makeResolver(makeWiqlClient([1]), { adoAllowUnknownFields: true });
    const scope: ReviewScope = {
      project: 'P',
      auth: AUTH,
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'Custom.NonExistentField', operator: '=', value: 'x' }],
      },
    };
    const result = await resolver.resolve(scope);
    expect(result.warnings.some((w) => w.includes('not in the known field catalog'))).toBe(true);
  });

  it('supports IN operator with array values', async () => {
    const client = makeWiqlClient([1, 2, 3]);
    const resolver = makeResolver(client);
    const scope: ReviewScope = {
      project: 'P',
      auth: AUTH,
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'System.State', operator: 'IN', value: ['Active', 'In Review'] }],
      },
    };
    const result = await resolver.resolve(scope);
    const call = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.wiql).toContain("[System.State] IN ('Active', 'In Review')");
    expect(result.ids).toHaveLength(3);
  });

  it('supports orderBy in compiled WIQL', async () => {
    const client = makeWiqlClient([1]);
    const resolver = makeResolver(client);
    const scope: ReviewScope = {
      project: 'P',
      auth: AUTH,
      source: {
        type: 'fieldFilters',
        filters: [{ field: 'System.State', operator: '=', value: 'Active' }],
        orderBy: [{ field: 'System.ChangedDate', direction: 'DESC' }],
      },
    };
    await resolver.resolve(scope);
    const call = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.wiql).toContain('ORDER BY [System.ChangedDate] DESC');
  });
});

// ─── linkedItems source ───────────────────────────────────────────────────────

describe('ReviewScopeResolver — linkedItems source', () => {
  it('throws CONFIGURATION_ERROR when workItemService not injected', async () => {
    const resolver = makeResolver(makeWiqlClient()); // no workItemService
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 123 } };
    await expect(resolver.resolve(scope)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('includes root ID in result', async () => {
    const wis = makeWorkItemService([[makeItem(100, [])]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 100, depth: 1 } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toContain(100);
  });

  it('traverses direct links (depth=1)', async () => {
    const root = makeItem(1, [
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/2', attributes: {} },
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/3', attributes: {} },
    ]);
    const wis = makeWorkItemService([[root]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 1 } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toContain(1);
    expect(result.ids).toContain(2);
    expect(result.ids).toContain(3);
    expect(result.totalMatched).toBe(3);
  });

  it('skips non-WI relation types (ArtifactLink, Hyperlink)', async () => {
    const root = makeItem(1, [
      { rel: 'ArtifactLink', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/99', attributes: {} },
      { rel: 'Hyperlink', url: 'https://example.com', attributes: {} },
      { rel: 'System.LinkTypes.Related', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/2', attributes: {} },
    ]);
    const wis = makeWorkItemService([[root]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 1 } };
    const result = await resolver.resolve(scope);
    expect(result.ids).not.toContain(99);
    expect(result.ids).toContain(2);
  });

  it('filters by relationTypes when specified', async () => {
    const root = makeItem(1, [
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/2', attributes: {} },
      { rel: 'System.LinkTypes.Related', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/3', attributes: {} },
    ]);
    const wis = makeWorkItemService([[root]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = {
      source: {
        type: 'linkedItems',
        rootId: 1,
        depth: 1,
        relationTypes: ['System.LinkTypes.Hierarchy-Forward'],
      },
    };
    const result = await resolver.resolve(scope);
    expect(result.ids).toContain(2);
    expect(result.ids).not.toContain(3);
  });

  it('does not revisit already-visited IDs across levels', async () => {
    // Level 0: root=1 → links to 2
    // Level 1: item=2 → links back to 1 (already visited) and to 3
    const root = makeItem(1, [
      { rel: 'System.LinkTypes.Related', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/2', attributes: {} },
    ]);
    const item2 = makeItem(2, [
      { rel: 'System.LinkTypes.Related', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/1', attributes: {} },
      { rel: 'System.LinkTypes.Related', url: 'https://tfs/tfs/Coll/_apis/wit/workItems/3', attributes: {} },
    ]);
    const wis = makeWorkItemService([[root], [item2]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 2 } };
    const result = await resolver.resolve(scope);
    expect(result.ids).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(result.ids).toHaveLength(3); // no duplicates
  });

  it('caps depth at 3', async () => {
    // Chain: 1→2→3→4→5 — with depth=99 we expect only 3 BFS expansions (max depth capped at 3)
    const mkRel = (id: number) => ({
      rel: 'System.LinkTypes.Related',
      url: `https://tfs/tfs/Coll/_apis/wit/workItems/${id}`,
      attributes: {},
    });
    const wis = makeWorkItemService([
      [makeItem(1, [mkRel(2)])],  // level 0 frontier: [1]
      [makeItem(2, [mkRel(3)])],  // level 1 frontier: [2]
      [makeItem(3, [mkRel(4)])],  // level 2 frontier: [3]  ← last allowed (maxDepth=3)
    ]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 99 } };
    const result = await resolver.resolve(scope);
    expect(wis.fetchWithRelations).toHaveBeenCalledTimes(3);
    expect(result.ids).toContain(4); // discovered at level 2 expansion
    expect(result.ids).not.toContain(5); // would only appear at level 3, which is beyond cap
  });

  it('emits warning when breadth cap hit', async () => {
    const relations = Array.from({ length: 150 }, (_, i) => ({
      rel: 'System.LinkTypes.Related',
      url: `https://tfs/tfs/Coll/_apis/wit/workItems/${i + 10}`,
      attributes: {},
    }));
    const root = makeItem(1, relations);
    const wis = makeWorkItemService([[root], []]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 2 } };
    const result = await resolver.resolve(scope);
    expect(result.warnings.some((w) => w.includes('capped'))).toBe(true);
    expect(result.ids.length).toBeLessThanOrEqual(101); // root + 100 cap
  });

  it('sets sourceType to linkedItems', async () => {
    const wis = makeWorkItemService([[makeItem(1)]]);
    const resolver = makeResolver(makeWiqlClient(), {}, wis);
    const scope: ReviewScope = { source: { type: 'linkedItems', rootId: 1, depth: 1 } };
    const result = await resolver.resolve(scope);
    expect(result.sourceType).toBe('linkedItems');
  });
});

// ─── savedQuery source ────────────────────────────────────────────────────────

describe('ReviewScopeResolver — savedQuery source', () => {
  it('throws NOT_IMPLEMENTED for savedQuery', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'savedQuery', queryPathOrId: 'Shared Queries/All Requirements' } };
    await expect(resolver.resolve(scope)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('AdoScopeError is instanceof AdoScopeError', async () => {
    const resolver = makeResolver(makeWiqlClient());
    const scope: ReviewScope = { source: { type: 'savedQuery', queryPathOrId: 'q' } };
    await expect(resolver.resolve(scope)).rejects.toBeInstanceOf(AdoScopeError);
  });
});
