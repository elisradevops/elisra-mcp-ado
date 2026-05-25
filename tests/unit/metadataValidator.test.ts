import { describe, it, expect, vi } from 'vitest';
import { MetadataValidator } from '../../src/services/metadataValidator.js';
import type { FieldsClient } from '../../src/ado/fieldsClient.js';
import type { LinkTypesClient } from '../../src/ado/linkTypesClient.js';
import type { WorkItemTypesClient } from '../../src/ado/workItemTypesClient.js';

const AUTH = { mode: 'per_request_pat' as const, pat: 'fakepatfakepatfakepatfakepatfakepatfakepatfakepatfakepat' };

function makeFieldsClient(referenceNames: string[] = [], displayNames: string[] = []): FieldsClient {
  return {
    listFields: vi.fn().mockResolvedValue(
      referenceNames.map((ref, i) => ({ referenceName: ref, name: displayNames[i] ?? ref }))
    ),
  } as unknown as FieldsClient;
}

function makeLinkTypesClient(referenceNames: string[] = []): LinkTypesClient {
  return {
    listRelationTypes: vi.fn().mockResolvedValue(
      referenceNames.map((ref) => ({ referenceName: ref }))
    ),
  } as unknown as LinkTypesClient;
}

function makeWorkItemTypesClient(names: string[] = []): WorkItemTypesClient {
  return {
    listTypes: vi.fn().mockResolvedValue(
      names.map((n) => ({ name: n, referenceName: `Microsoft.VSTS.Common.${n.replace(/ /g, '')}` }))
    ),
  } as unknown as WorkItemTypesClient;
}

// ─── field validation ─────────────────────────────────────────────────────────

describe('MetadataValidator — field validation', () => {
  it('returns ok:true when all fields are known', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(['System.Title', 'System.State']),
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );
    const result = await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(result.ok).toBe(true);
  });

  it('returns UNKNOWN_FIELD when field not in ADO response', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(['System.Title']),
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );
    const result = await validator.validate({ fields: ['Custom.NonExistent'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_FIELD');
      expect(result.unknown).toContain('Custom.NonExistent');
      expect(result.hint).toMatch(/ado_discover_fields/i);
    }
  });

  it('accepts field by display name (case-insensitive)', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(['System.Title'], ['Title']),
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );
    // Display name 'Title' matched case-insensitively; 'title' is valid.
    const result = await validator.validate({ fields: ['title'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(result.ok).toBe(true);
  });

  it('rejects wrong-case reference name (reference names are case-sensitive in ADO)', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(['System.Title'], ['Title']),
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );
    // 'system.title' is not the reference name ('System.Title') nor a display name.
    const result = await validator.validate({ fields: ['system.title'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_FIELD');
      expect(result.unknown).toContain('system.title');
    }
  });
});

// ─── work item type validation ────────────────────────────────────────────────

describe('MetadataValidator — work item type validation', () => {
  it('returns ok:true when WIT is known', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(),
      makeWorkItemTypesClient(['Requirement'])
    );
    const result = await validator.validate(
      { fields: [], workItemTypes: ['Requirement'], linkTypes: [], project: 'P' },
      AUTH
    );
    expect(result.ok).toBe(true);
  });

  it('returns UNKNOWN_WORK_ITEM_TYPE when WIT not in ADO response', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(),
      makeWorkItemTypesClient(['Requirement'])
    );
    const result = await validator.validate(
      { fields: [], workItemTypes: ['GhostType'], linkTypes: [], project: 'P' },
      AUTH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_WORK_ITEM_TYPE');
      expect(result.unknown).toContain('GhostType');
      expect(result.hint).toBeTruthy();
    }
  });

  it('rejects lowercase variant of a known WIT (WIT names are case-sensitive in ADO)', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(),
      makeWorkItemTypesClient(['Requirement'])
    );
    const result = await validator.validate(
      { fields: [], workItemTypes: ['requirement'], linkTypes: [], project: 'P' },
      AUTH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_WORK_ITEM_TYPE');
      expect(result.unknown).toContain('requirement');
    }
  });

  it('skips WIT validation when project is not provided', async () => {
    const witClient = makeWorkItemTypesClient([]);
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(),
      witClient
    );
    // project undefined — should skip WIT check entirely
    const result = await validator.validate({ fields: [], workItemTypes: ['Unknown'], linkTypes: [] }, AUTH);
    expect(result.ok).toBe(true);
    expect(witClient.listTypes).not.toHaveBeenCalled();
  });
});

// ─── link type validation ─────────────────────────────────────────────────────

describe('MetadataValidator — link type validation', () => {
  it('returns ok:true when link type is known', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(['Elisra.CoveredBy-Forward']),
      makeWorkItemTypesClient()
    );
    const result = await validator.validate({ fields: [], workItemTypes: [], linkTypes: ['Elisra.CoveredBy-Forward'] }, AUTH);
    expect(result.ok).toBe(true);
  });

  it('returns UNKNOWN_LINK_TYPE when link type not in ADO response', async () => {
    const validator = new MetadataValidator(
      makeFieldsClient(),
      makeLinkTypesClient(['Elisra.CoveredBy-Forward']),
      makeWorkItemTypesClient()
    );
    const result = await validator.validate({ fields: [], workItemTypes: [], linkTypes: ['Custom.Fake-Forward'] }, AUTH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_LINK_TYPE');
      expect(result.unknown).toContain('Custom.Fake-Forward');
      expect(result.hint).toMatch(/ado_discover_link_types/i);
    }
  });
});

// ─── TTL cache behavior ───────────────────────────────────────────────────────

describe('MetadataValidator — TTL cache', () => {
  it('calls listFields only once for two requests within TTL', async () => {
    const fieldsClient = makeFieldsClient(['System.Title']);
    const validator = new MetadataValidator(
      fieldsClient,
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );
    await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, AUTH);
    await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(fieldsClient.listFields).toHaveBeenCalledOnce();
  });

  it('re-fetches fields after TTL expires', async () => {
    const fieldsClient = makeFieldsClient(['System.Title']);
    const fakeClock = vi.fn().mockReturnValue(0);
    const validator = new MetadataValidator(
      fieldsClient,
      makeLinkTypesClient(),
      makeWorkItemTypesClient(),
      fakeClock
    );
    await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, AUTH);
    // Advance clock past 1h TTL
    fakeClock.mockReturnValue(60 * 60 * 1000 + 1);
    await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, AUTH);
    expect(fieldsClient.listFields).toHaveBeenCalledTimes(2);
  });

  it('does not share field cache across different auth modes', async () => {
    // Two callers sharing one validator instance but using different auth modes.
    // Each should get their own cache slot — no cross-auth pollution.
    const fieldsClientA = makeFieldsClient(['System.Title']);
    const fieldsClientB = makeFieldsClient(['Custom.Field']);

    // Single validator; we swap the underlying client between calls via a proxy.
    let activeClient = fieldsClientA as unknown as { listFields: ReturnType<typeof vi.fn> };
    const proxyFieldsClient = {
      listFields: vi.fn().mockImplementation((auth: unknown) => activeClient.listFields(auth)),
    } as unknown as import('../../src/ado/fieldsClient.js').FieldsClient;

    const validator = new MetadataValidator(
      proxyFieldsClient,
      makeLinkTypesClient(),
      makeWorkItemTypesClient()
    );

    const authA = { mode: 'per_request_pat' as const, pat: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    const authB = { mode: 'per_request_pat' as const, pat: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };

    activeClient = { listFields: vi.fn().mockResolvedValue([{ referenceName: 'System.Title', name: 'Title' }]) };
    await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, authA);

    activeClient = { listFields: vi.fn().mockResolvedValue([{ referenceName: 'Custom.Field', name: 'Custom Field' }]) };
    // authB has never been cached — must call listFields again
    const resultB = await validator.validate({ fields: ['Custom.Field'], workItemTypes: [], linkTypes: [] }, authB);
    expect(resultB.ok).toBe(true);

    // authA cached 'System.Title'; authB cached 'Custom.Field'. They don't share.
    activeClient = { listFields: vi.fn().mockResolvedValue([]) };
    const resultA2 = await validator.validate({ fields: ['System.Title'], workItemTypes: [], linkTypes: [] }, authA);
    // authA cache still warm — should not call listFields again
    expect(activeClient.listFields).not.toHaveBeenCalled();
    expect(resultA2.ok).toBe(true);
  });
});
