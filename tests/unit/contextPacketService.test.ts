import { describe, it, expect, vi } from 'vitest';
import { ContextPacketService } from '../../src/services/contextPacketService.js';
import type { WorkItemService } from '../../src/services/workItemService.js';
import type { IWiqlClient } from '../../src/ado/wiqlClient.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import type { AppConfig } from '../../src/config/config.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const AUTH = { mode: 'per_request_pat' as const, pat: 'test-pat' };

const baseConfig = {
  adoOrgUrl: 'https://tfs.example.local/tfs/Coll',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAllowUnknownFields: false,
} as unknown as AppConfig;

function makeItem(
  id: number,
  fields: Record<string, unknown> = {},
  relations?: AdoWorkItem['relations']
): AdoWorkItem {
  return {
    id,
    fields: {
      'System.Id': id,
      'System.Title': `Item ${id}`,
      'System.WorkItemType': 'Requirement',
      'System.State': 'Active',
      'System.AreaPath': 'Project',
      'System.IterationPath': 'Project\\Sprint 1',
      'System.AssignedTo': null,
      'System.ChangedDate': '2025-01-01',
      'System.TeamProject': 'Project',
      ...fields,
    },
    relations,
  };
}

function rel(relType: string, targetId: number): NonNullable<AdoWorkItem['relations']>[number] {
  return { rel: relType, url: `https://tfs/tfs/Coll/_apis/wit/workItems/${targetId}`, attributes: {} };
}

type FetchCall = { ids: number[]; options?: Record<string, unknown> };

function makeWorkItemService(
  responses: Map<string, AdoWorkItem[]> = new Map(),
  defaultItems: AdoWorkItem[] = []
): WorkItemService & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetchMany: vi.fn().mockImplementation((ids: number[], _auth: unknown, options?: unknown) => {
      calls.push({ ids: [...ids], options: options as Record<string, unknown> });
      const key = ids.sort((a, b) => a - b).join(',');
      return Promise.resolve(responses.get(key) ?? defaultItems);
    }),
    fetchCompact: vi.fn().mockResolvedValue([]),
    fetchWithRelations: vi.fn().mockResolvedValue([]),
  } as unknown as WorkItemService & { calls: FetchCall[] };
}

function makeWiqlClient(ids: number[] = []): IWiqlClient {
  return {
    execute: vi.fn().mockResolvedValue({ ids, totalMatched: ids.length, queryType: 'flat' }),
  };
}

function makeSvc(
  workItemService: WorkItemService,
  wiqlClient?: IWiqlClient
): ContextPacketService {
  return new ContextPacketService(
    workItemService,
    wiqlClient ?? makeWiqlClient(),
    baseConfig,
    createSilentLogger()
  );
}

// ─── basic packet structure ───────────────────────────────────────────────────

describe('ContextPacketService — basic packet', () => {
  it('returns root work item in workItem field', async () => {
    const root = makeItem(100, { 'System.Title': 'Root Req' }, []);
    const wis = makeWorkItemService(new Map([['100', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(100, {}, AUTH);
    expect(packet.workItem.id).toBe(100);
    expect(packet.workItem.title).toBe('Root Req');
  });

  it('throws when root item not found', async () => {
    const wis = makeWorkItemService(new Map(), []);
    const svc = makeSvc(wis);
    await expect(svc.build(999, {}, AUTH)).rejects.toThrow('not found');
  });

  it('returns empty arrays when root has no relations', async () => {
    const root = makeItem(1, {}, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.parents).toHaveLength(0);
    expect(packet.children).toHaveLength(0);
    expect(packet.covers).toHaveLength(0);
    expect(packet.coveredBy).toHaveLength(0);
    expect(packet.tests).toHaveLength(0);
    expect(packet.related).toHaveLength(0);
    expect(packet.siblings).toHaveLength(0);
    expect(packet.sameField).toHaveLength(0);
    expect(packet.truncated).toHaveLength(0);
  });
});

// ─── relation classification ──────────────────────────────────────────────────

describe('ContextPacketService — relation classification', () => {
  it('classifies Hierarchy-Forward as children', async () => {
    const child2 = makeItem(2, {}, []);
    const child3 = makeItem(3, {}, []);
    const root = makeItem(1, {}, [
      rel('System.LinkTypes.Hierarchy-Forward', 2),
      rel('System.LinkTypes.Hierarchy-Forward', 3),
    ]);
    const wis = makeWorkItemService(
      new Map([['1', [root]], ['2,3', [child2, child3]], ['2', [child2]], ['3', [child3]]])
    );
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { childrenDepth: 1 }, AUTH);
    expect(packet.children.map((c) => c.id)).toEqual(expect.arrayContaining([2, 3]));
  });

  it('classifies Hierarchy-Reverse as parents', async () => {
    const parent = makeItem(10, {}, []);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 10)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['10', [parent]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { parentDepth: 1 }, AUTH);
    expect(packet.parents.map((p) => p.id)).toContain(10);
  });

  it('classifies Elisra.CoveredBy-Forward as covers', async () => {
    const covered = makeItem(20, {}, []);
    const root = makeItem(1, {}, [rel('Elisra.CoveredBy-Forward', 20)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['20', [covered]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.covers.map((c) => c.id)).toContain(20);
  });

  it('classifies Elisra.CoveredBy-Reverse as coveredBy', async () => {
    const covering = makeItem(30, {}, []);
    const root = makeItem(1, {}, [rel('Elisra.CoveredBy-Reverse', 30)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['30', [covering]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.coveredBy.map((c) => c.id)).toContain(30);
  });

  it('classifies TestedBy-Forward as tests', async () => {
    const test = makeItem(40, { 'System.WorkItemType': 'Test Case' }, []);
    const root = makeItem(1, {}, [rel('Microsoft.VSTS.Common.TestedBy-Forward', 40)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['40', [test]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.tests.map((t) => t.id)).toContain(40);
  });

  it('classifies Related as related', async () => {
    const related = makeItem(50, {}, []);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Related', 50)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['50', [related]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.related.map((r) => r.id)).toContain(50);
  });

  it('classifies Affects-Forward as covers', async () => {
    const affected = makeItem(60, {}, []);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Affects-Forward', 60)]);
    const wis = makeWorkItemService(new Map([['1', [root]], ['60', [affected]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.covers.map((c) => c.id)).toContain(60);
  });
});

// ─── description trimming ──────────────────────────────────────────────────────

describe('ContextPacketService — description trimming', () => {
  it('trims description to descriptionMaxChars', async () => {
    const longDesc = 'A'.repeat(3000);
    const root = makeItem(1, { 'System.Description': longDesc }, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { descriptionMaxChars: 100 }, AUTH);
    expect(String(packet.workItem.description).length).toBeLessThanOrEqual(120); // 100 + truncation suffix
    expect(String(packet.workItem.description)).toContain('[truncated]');
  });

  it('does not add truncation suffix when description fits', async () => {
    const root = makeItem(1, { 'System.Description': 'Short description' }, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { descriptionMaxChars: 2000 }, AUTH);
    expect(String(packet.workItem.description)).not.toContain('[truncated]');
  });

  it('strips HTML from description', async () => {
    const root = makeItem(1, { 'System.Description': '<p><b>Bold text</b> and more.</p>' }, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(String(packet.workItem.description)).not.toContain('<');
    expect(String(packet.workItem.description)).toContain('Bold text');
  });
});

// ─── parent traversal depth ───────────────────────────────────────────────────

describe('ContextPacketService — parent traversal', () => {
  it('traverses parents up to parentDepth levels', async () => {
    // root(1) ← parent(2) ← grandparent(3)
    const grandparent = makeItem(3, {}, []);
    const parent = makeItem(2, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 3)]);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 2)]);

    const responses = new Map([
      ['1', [root]],
      ['2', [parent]],
      ['3', [grandparent]],
    ]);
    const wis = makeWorkItemService(responses);
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { parentDepth: 2, childrenDepth: 0 }, AUTH);
    expect(packet.parents.map((p) => p.id)).toContain(2);
    expect(packet.parents.map((p) => p.id)).toContain(3);
  });

  it('stops at parentDepth=1', async () => {
    const parent = makeItem(2, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 3)]);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 2)]);
    const responses = new Map([['1', [root]], ['2', [parent]]]);
    const wis = makeWorkItemService(responses);
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { parentDepth: 1, childrenDepth: 0 }, AUTH);
    expect(packet.parents.map((p) => p.id)).toContain(2);
    expect(packet.parents.map((p) => p.id)).not.toContain(3);
  });
});

// ─── siblings ─────────────────────────────────────────────────────────────────

describe('ContextPacketService — siblings', () => {
  it('returns siblings when includeSiblings=true', async () => {
    const sibling = makeItem(5, {}, []);
    // parent has root(1) and sibling(5) as children
    const parent = makeItem(2, {}, [
      rel('System.LinkTypes.Hierarchy-Forward', 1),
      rel('System.LinkTypes.Hierarchy-Forward', 5),
    ]);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 2)]);

    const responses = new Map([
      ['1', [root]],
      ['2', [parent]],
      ['5', [sibling]],
    ]);
    const wis = makeWorkItemService(responses);
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { includeSiblings: true, childrenDepth: 0 }, AUTH);
    expect(packet.siblings.map((s) => s.id)).toContain(5);
    expect(packet.siblings.map((s) => s.id)).not.toContain(1); // root excluded
  });

  it('returns empty siblings when includeSiblings=false', async () => {
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 2)]);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { includeSiblings: false }, AUTH);
    expect(packet.siblings).toHaveLength(0);
  });

  it('emits truncation note when siblings exceed max', async () => {
    const siblingRelations = Array.from({ length: 60 }, (_, i) =>
      rel('System.LinkTypes.Hierarchy-Forward', i + 10)
    );
    const parent = makeItem(2, {}, [
      rel('System.LinkTypes.Hierarchy-Forward', 1), // root itself
      ...siblingRelations,
    ]);
    const root = makeItem(1, {}, [rel('System.LinkTypes.Hierarchy-Reverse', 2)]);
    const siblingItems = Array.from({ length: 50 }, (_, i) => makeItem(i + 10));

    const responses = new Map<string, AdoWorkItem[]>([
      ['1', [root]],
      ['2', [parent]],
    ]);
    // Default: return 50 items for any multi-id fetch
    const wis = makeWorkItemService(responses, siblingItems);
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { includeSiblings: true, siblingMax: 50, childrenDepth: 0 }, AUTH);
    expect(packet.truncated.some((t) => t.kind === 'siblings')).toBe(true);
    const note = packet.truncated.find((t) => t.kind === 'siblings')!;
    expect(note.total).toBe(60);
    expect(note.included).toBe(50);
  });
});

// ─── sameField ────────────────────────────────────────────────────────────────

describe('ContextPacketService — sameField', () => {
  it('queries ADO for items with same field value', async () => {
    const peer = makeItem(99, {});
    const root = makeItem(1, { 'Custom.SubSystem': 'Navigation', 'System.TeamProject': 'Proj' }, []);
    const responses = new Map([['1', [root]], ['99', [peer]]]);
    const wis = makeWorkItemService(responses);
    const wiqlClient = makeWiqlClient([1, 99]); // returns root + peer
    const svc = makeSvc(wis, wiqlClient);

    const packet = await svc.build(1, { contextField: 'Custom.SubSystem', project: 'Proj' }, AUTH);
    // root excluded from sameField results
    expect(packet.sameField.map((s) => s.id)).not.toContain(1);
    expect(packet.sameField.map((s) => s.id)).toContain(99);
  });

  it('returns empty sameField when contextField not specified', async () => {
    const root = makeItem(1, {}, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const wiqlClient = makeWiqlClient([]);
    const svc = makeSvc(wis, wiqlClient);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.sameField).toHaveLength(0);
    expect(wiqlClient.execute).not.toHaveBeenCalled();
  });

  it('returns empty sameField when field value is null', async () => {
    const root = makeItem(1, { 'Custom.SubSystem': null }, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const wiqlClient = makeWiqlClient([2, 3]);
    const svc = makeSvc(wis, wiqlClient);
    const packet = await svc.build(1, { contextField: 'Custom.SubSystem', project: 'Proj' }, AUTH);
    expect(packet.sameField).toHaveLength(0);
    expect(wiqlClient.execute).not.toHaveBeenCalled();
  });

  it('emits truncation note when sameField results exceed max', async () => {
    const root = makeItem(1, { 'Custom.SubSystem': 'Nav', 'System.TeamProject': 'Proj' }, []);
    const peerIds = Array.from({ length: 60 }, (_, i) => i + 2);
    const wis = makeWorkItemService(
      new Map([['1', [root]]]),
      peerIds.map((id) => makeItem(id))
    );
    const wiqlClient = makeWiqlClient([1, ...peerIds]);
    const svc = makeSvc(wis, wiqlClient);

    const packet = await svc.build(1, { contextField: 'Custom.SubSystem', project: 'Proj', sameFieldMax: 50 }, AUTH);
    expect(packet.truncated.some((t) => t.kind === 'sameField')).toBe(true);
    const note = packet.truncated.find((t) => t.kind === 'sameField')!;
    expect(note.total).toBe(60); // 61 - 1 (root excluded)
    expect(note.included).toBe(50);
  });
});

// ─── truncated field ──────────────────────────────────────────────────────────

describe('ContextPacketService — truncation notes', () => {
  it('truncated is empty when no caps hit', async () => {
    const root = makeItem(1, {}, []);
    const wis = makeWorkItemService(new Map([['1', [root]]]));
    const svc = makeSvc(wis);
    const packet = await svc.build(1, {}, AUTH);
    expect(packet.truncated).toHaveLength(0);
  });

  it('truncated has entry when children exceed breadth cap', async () => {
    const childRelations = Array.from({ length: 120 }, (_, i) =>
      rel('System.LinkTypes.Hierarchy-Forward', i + 100)
    );
    const root = makeItem(1, {}, childRelations);
    const wis = makeWorkItemService(
      new Map([['1', [root]]]),
      Array.from({ length: 100 }, (_, i) => makeItem(i + 100))
    );
    const svc = makeSvc(wis);
    const packet = await svc.build(1, { childrenDepth: 1, childrenBreadth: 100 }, AUTH);
    expect(packet.truncated.some((t) => t.kind.startsWith('children'))).toBe(true);
    const note = packet.truncated.find((t) => t.kind.startsWith('children'))!;
    expect(note.total).toBe(120);
    expect(note.included).toBe(100);
  });
});
