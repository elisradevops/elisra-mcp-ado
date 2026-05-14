import { describe, it, expect, vi } from 'vitest';
import { LinkTypeDiscoveryService } from '../../src/services/linkTypeDiscoveryService.js';
import type { LinkTypesClient } from '../../src/ado/linkTypesClient.js';
import type { AdoWorkItemRelationType } from '../../src/types/ado.js';
import type { AuthContext } from '../../src/auth/authContext.js';
import { ADO_LINK_TYPES } from '../../src/domain/adoLinkTypes.js';

const mockAuth: AuthContext = { mode: 'per_request_pat', pat: 'test-pat' };

function makeRelationType(
  referenceName: string,
  name: string,
  usage: 'workItemLink' | 'resourceLink' | 'remoteWorkItemLink' | string = 'workItemLink'
): AdoWorkItemRelationType {
  return {
    referenceName,
    name,
    attributes: { usage },
  };
}

function makeClient(types: AdoWorkItemRelationType[]): LinkTypesClient {
  return {
    listRelationTypes: vi.fn().mockResolvedValue(types),
  } as unknown as LinkTypesClient;
}

describe('LinkTypeDiscoveryService — basic discovery', () => {
  it('returns discovered link types from ADO', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child'),
      makeRelationType(ADO_LINK_TYPES.RELATED, 'Related'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const refs = out.linkTypes.map((lt) => lt.referenceName);
    expect(refs).toContain(ADO_LINK_TYPES.HIERARCHY_FORWARD);
    expect(refs).toContain(ADO_LINK_TYPES.RELATED);
  });

  it('tags discovered+seed types as source=both', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HIERARCHY_FORWARD);
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('both');
    expect(entry!.knownInDocGen).toBe(true);
  });

  it('keeps seed-only types with source=seed when ADO does not return them', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth, includeAll: true });

    const related = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.RELATED);
    expect(related).toBeDefined();
    expect(related!.source).toBe('seed');
    expect(related!.knownInDocGen).toBe(true);
  });

  it('tags novel ADO types (not in seed) as source=discovered', async () => {
    const client = makeClient([
      makeRelationType('Custom.NewLinkType', 'New Link'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === 'Custom.NewLinkType');
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('discovered');
    expect(entry!.knownInDocGen).toBe(false);
    expect(entry!.isCustom).toBe(true);
  });

  it('populates semanticHint for Elisra custom types', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD, 'Covered by'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD);
    expect(entry).toBeDefined();
    expect(entry!.semanticHint).toBeDefined();
    expect(entry!.isCustom).toBe(true);
  });
});

describe('LinkTypeDiscoveryService — includeAll filter', () => {
  it('excludes resourceLink types by default', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child', 'workItemLink'),
      makeRelationType(ADO_LINK_TYPES.ARTIFACT_LINK, 'Artifact Link', 'resourceLink'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const refs = out.linkTypes.map((lt) => lt.referenceName);
    expect(refs).toContain(ADO_LINK_TYPES.HIERARCHY_FORWARD);
    expect(refs).not.toContain(ADO_LINK_TYPES.ARTIFACT_LINK);
  });

  it('includes resourceLink types when includeAll=true', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child', 'workItemLink'),
      makeRelationType(ADO_LINK_TYPES.ARTIFACT_LINK, 'Artifact Link', 'resourceLink'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth, includeAll: true });

    const refs = out.linkTypes.map((lt) => lt.referenceName);
    expect(refs).toContain(ADO_LINK_TYPES.HIERARCHY_FORWARD);
    expect(refs).toContain(ADO_LINK_TYPES.ARTIFACT_LINK);
  });

  it('seed-only non-WI types excluded by default and included with includeAll', async () => {
    const client = makeClient([]);
    const svc = new LinkTypeDiscoveryService(client);

    const defaultOut = await svc.discover({ auth: mockAuth });
    expect(defaultOut.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HYPERLINK)).toBeUndefined();

    const allOut = await svc.discover({ auth: mockAuth, includeAll: true });
    expect(allOut.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HYPERLINK)).toBeDefined();
  });
});

describe('LinkTypeDiscoveryService — caching', () => {
  it('calls listRelationTypes only once for repeated calls', async () => {
    const client = makeClient([makeRelationType(ADO_LINK_TYPES.RELATED, 'Related')]);
    const svc = new LinkTypeDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth });

    expect(client.listRelationTypes).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expires', async () => {
    let now = 0;
    const client = makeClient([makeRelationType(ADO_LINK_TYPES.RELATED, 'Related')]);
    const svc = new LinkTypeDiscoveryService(client, () => now);

    await svc.discover({ auth: mockAuth });
    now = 60 * 60 * 1_000 + 1;
    await svc.discover({ auth: mockAuth });

    expect(client.listRelationTypes).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-fetch before TTL expires', async () => {
    let now = 0;
    const client = makeClient([makeRelationType(ADO_LINK_TYPES.RELATED, 'Related')]);
    const svc = new LinkTypeDiscoveryService(client, () => now);

    await svc.discover({ auth: mockAuth });
    now = 60 * 60 * 1_000 - 1;
    await svc.discover({ auth: mockAuth });

    expect(client.listRelationTypes).toHaveBeenCalledTimes(1);
  });

  it('refresh=true forces re-fetch', async () => {
    const client = makeClient([makeRelationType(ADO_LINK_TYPES.RELATED, 'Related')]);
    const svc = new LinkTypeDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth, refresh: true });

    expect(client.listRelationTypes).toHaveBeenCalledTimes(2);
  });

  it('invalidate() clears cache', async () => {
    const client = makeClient([makeRelationType(ADO_LINK_TYPES.RELATED, 'Related')]);
    const svc = new LinkTypeDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    svc.invalidate();
    await svc.discover({ auth: mockAuth });

    expect(client.listRelationTypes).toHaveBeenCalledTimes(2);
  });
});

describe('LinkTypeDiscoveryService — seed fallback', () => {
  it('buildSeedFallback returns seed-only catalog with warning', () => {
    const client = makeClient([]);
    const svc = new LinkTypeDiscoveryService(client);

    const out = svc.buildSeedFallback('Network error');

    expect(out.source).toBe('seed_fallback');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('Network error');
    expect(out.linkTypes.length).toBeGreaterThan(0);
  });

  it('buildSeedFallback filters to workItemLink by default', () => {
    const client = makeClient([]);
    const svc = new LinkTypeDiscoveryService(client);

    const out = svc.buildSeedFallback('err');
    expect(out.linkTypes.every((lt) => lt.isWorkItemLink)).toBe(true);
    expect(out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ARTIFACT_LINK)).toBeUndefined();
  });

  it('buildSeedFallback all entries have source=seed', () => {
    const client = makeClient([]);
    const svc = new LinkTypeDiscoveryService(client);

    const out = svc.buildSeedFallback('err');
    expect(out.linkTypes.every((lt) => lt.source === 'seed')).toBe(true);
  });
});

describe('LinkTypeDiscoveryService — attributes absent edge cases', () => {
  it('does not classify a non-WI type as workItemLink when attributes is undefined', async () => {
    // Simulate ADO returning ArtifactLink without attributes (some ADO versions)
    const client = makeClient([
      { referenceName: ADO_LINK_TYPES.ARTIFACT_LINK, name: 'Artifact Link' } as AdoWorkItemRelationType,
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth, includeAll: true });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ARTIFACT_LINK);
    expect(entry).toBeDefined();
    expect(entry!.isWorkItemLink).toBe(false);
  });

  it('excludes non-WI type with missing attributes from default (non-includeAll) output', async () => {
    const client = makeClient([
      { referenceName: ADO_LINK_TYPES.HYPERLINK, name: 'Hyperlink' } as AdoWorkItemRelationType,
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    expect(out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HYPERLINK)).toBeUndefined();
  });
});

describe('LinkTypeDiscoveryService — buildSeedFallback includeAll', () => {
  it('buildSeedFallback with includeAll=true includes resourceLink types', () => {
    const client = makeClient([]);
    const svc = new LinkTypeDiscoveryService(client);

    const out = svc.buildSeedFallback('err', true);
    expect(out.source).toBe('seed_fallback');
    expect(out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ARTIFACT_LINK)).toBeDefined();
    expect(out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HYPERLINK)).toBeDefined();
  });

  it('cache hit with includeAll=true returns resource-link types (filtering is post-cache)', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.HIERARCHY_FORWARD, 'Child', 'workItemLink'),
      makeRelationType(ADO_LINK_TYPES.ARTIFACT_LINK, 'Artifact Link', 'resourceLink'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);

    // Seed cache with includeAll=false call
    await svc.discover({ auth: mockAuth });
    expect(client.listRelationTypes).toHaveBeenCalledTimes(1);

    // Second call with includeAll=true should hit cache but still return resourceLink types
    const out = await svc.discover({ auth: mockAuth, includeAll: true });
    expect(client.listRelationTypes).toHaveBeenCalledTimes(1); // still cached
    expect(out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ARTIFACT_LINK)).toBeDefined();
  });
});

describe('LinkTypeDiscoveryService — sort order', () => {
  it('places custom (Elisra) types before system types', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.RELATED, 'Related'),
      makeRelationType(ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD, 'Covered by'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const firstCustomIdx = out.linkTypes.findIndex((lt) => lt.isCustom);
    const firstSystemIdx = out.linkTypes.findIndex((lt) => !lt.isCustom);
    expect(firstCustomIdx).toBeLessThan(firstSystemIdx);
  });
});

// ─── isForward / oppositeEndReferenceName propagation ────────────────────────

function makeRelationTypeWithAttrs(
  referenceName: string,
  name: string,
  extra: Partial<NonNullable<AdoWorkItemRelationType['attributes']>> = {}
): AdoWorkItemRelationType {
  return {
    referenceName,
    name,
    attributes: { usage: 'workItemLink', ...extra },
  };
}

describe('LinkTypeDiscoveryService — isForward / oppositeEndReferenceName', () => {
  it('propagates isForward=true when ADO returns it', async () => {
    const client = makeClient([
      makeRelationTypeWithAttrs(
        ADO_LINK_TYPES.HIERARCHY_FORWARD,
        'Child',
        { isForward: true, oppositeEndReferenceName: ADO_LINK_TYPES.HIERARCHY_REVERSE }
      ),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HIERARCHY_FORWARD);
    expect(entry).toBeDefined();
    expect(entry!.isForward).toBe(true);
    expect(entry!.oppositeEndReferenceName).toBe(ADO_LINK_TYPES.HIERARCHY_REVERSE);
  });

  it('propagates isForward=false for reverse direction', async () => {
    const client = makeClient([
      makeRelationTypeWithAttrs(
        ADO_LINK_TYPES.HIERARCHY_REVERSE,
        'Parent',
        { isForward: false, oppositeEndReferenceName: ADO_LINK_TYPES.HIERARCHY_FORWARD }
      ),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.HIERARCHY_REVERSE);
    expect(entry).toBeDefined();
    expect(entry!.isForward).toBe(false);
    expect(entry!.oppositeEndReferenceName).toBe(ADO_LINK_TYPES.HIERARCHY_FORWARD);
  });

  it('omits isForward / oppositeEndReferenceName when not provided by ADO', async () => {
    const client = makeClient([
      makeRelationType(ADO_LINK_TYPES.RELATED, 'Related'),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.RELATED);
    expect(entry).toBeDefined();
    expect('isForward' in entry!).toBe(false);
    expect('oppositeEndReferenceName' in entry!).toBe(false);
  });

  it('propagates for custom Elisra link types', async () => {
    const client = makeClient([
      makeRelationTypeWithAttrs(
        ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD,
        'Covered by',
        { isForward: true, oppositeEndReferenceName: ADO_LINK_TYPES.ELISRA_COVERED_BY_REVERSE }
      ),
    ]);
    const svc = new LinkTypeDiscoveryService(client);
    const out = await svc.discover({ auth: mockAuth });

    const entry = out.linkTypes.find((lt) => lt.referenceName === ADO_LINK_TYPES.ELISRA_COVERED_BY_FORWARD);
    expect(entry?.isForward).toBe(true);
    expect(entry?.oppositeEndReferenceName).toBe(ADO_LINK_TYPES.ELISRA_COVERED_BY_REVERSE);
  });
});
