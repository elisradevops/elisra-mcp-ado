import { describe, it, expect, vi } from 'vitest';
import { FieldDiscoveryService } from '../../src/services/fieldDiscoveryService.js';
import { REVIEW_FIELDS } from '../../src/services/requirementReviewService.js';
import { CaseInsensitiveMap } from '../../src/utils/caseInsensitiveMap.js';
import type { FieldInfo } from '../../src/domain/adoFields.js';
import type { AuthContext } from '../../src/auth/authContext.js';
import type { FieldsClient } from '../../src/ado/fieldsClient.js';
import type { AdoFieldDefinition } from '../../src/types/ado.js';

// Mirrors the private helper in reviewTools.ts so we test the same logic in isolation.
// The helper is not exported, so we reproduce the exact same function here.
interface ResolvedReviewFields { fields: string[]; dropped: string[]; discoveryError?: string; }

async function resolveAvailableReviewFields(
  fieldDiscoveryService: FieldDiscoveryService,
  auth: AuthContext,
  project: string | undefined,
  extras: readonly string[],
  logger: { warn: (...a: unknown[]) => void },
): Promise<ResolvedReviewFields> {
  const requested = [...REVIEW_FIELDS, ...extras];
  const deduped = [...new Set(requested.map((s) => s.trim()).filter(Boolean))];
  try {
    const catalog = await fieldDiscoveryService.discover({ auth, project });
    const dropped: string[] = [];
    const kept: string[] = [];
    for (const ref of deduped) {
      if (ref.startsWith('System.') || catalog.has(ref)) {
        kept.push(ref);
      } else {
        dropped.push(ref);
      }
    }
    return { fields: kept, dropped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Field discovery unavailable; falling back to full requested set');
    return { fields: deduped, dropped: [], discoveryError: message };
  }
}

const mockAuth: AuthContext = { mode: 'per_request_pat', pat: 'test-pat' };
const silentLogger = { warn: vi.fn() };

function makeFieldInfo(referenceName: string): FieldInfo {
  return {
    referenceName,
    displayName: referenceName,
    type: 'string',
    isCustom: false,
    isIdentity: false,
    isLongText: false,
    isTreePath: false,
    allowedOperators: ['=', '<>'],
    knownInDocGen: false,
    safeForFiltering: true,
    safeForGrouping: true,
    historyTracked: false,
    source: 'discovered',
  };
}

function makeCatalog(refs: string[]): CaseInsensitiveMap<FieldInfo> {
  const m = new CaseInsensitiveMap<FieldInfo>();
  for (const ref of refs) m.set(ref, makeFieldInfo(ref));
  return m;
}

function makeDiscoveryService(catalog: CaseInsensitiveMap<FieldInfo>): FieldDiscoveryService {
  const client: FieldsClient = {
    listFields: vi.fn().mockResolvedValue([] as AdoFieldDefinition[]),
    listWorkItemTypeFields: vi.fn().mockResolvedValue([]),
  } as unknown as FieldsClient;
  const svc = new FieldDiscoveryService(client);
  vi.spyOn(svc, 'discover').mockResolvedValue(catalog);
  return svc;
}

describe('resolveAvailableReviewFields', () => {
  it('returns full REVIEW_FIELDS unchanged when all are present in catalog', async () => {
    // Build a catalog that contains every non-System field in REVIEW_FIELDS
    const nonSystemRefs = (REVIEW_FIELDS as readonly string[]).filter((r) => !r.startsWith('System.'));
    const catalog = makeCatalog(nonSystemRefs);
    const svc = makeDiscoveryService(catalog);

    const result = await resolveAvailableReviewFields(svc, mockAuth, 'MyProject', [], silentLogger);

    expect(result.dropped).toHaveLength(0);
    expect(result.fields).toEqual([...REVIEW_FIELDS]);
    expect(result.discoveryError).toBeUndefined();
  });

  it('drops missing non-System fields and lists them in dropped', async () => {
    // Catalog is empty (no non-System fields) — simulates Agile/Scrum collection without CMMI fields
    const catalog = makeCatalog([]);
    const svc = makeDiscoveryService(catalog);

    const result = await resolveAvailableReviewFields(svc, mockAuth, 'AgileProject', [], silentLogger);

    const expectedDropped = (REVIEW_FIELDS as readonly string[]).filter((r) => !r.startsWith('System.'));
    expect(result.dropped).toEqual(expect.arrayContaining(expectedDropped));
    expect(result.dropped).toHaveLength(expectedDropped.length);

    // System.* refs must still be in the kept list
    const systemRefs = (REVIEW_FIELDS as readonly string[]).filter((r) => r.startsWith('System.'));
    for (const ref of systemRefs) {
      expect(result.fields).toContain(ref);
    }

    // Dropped refs must not be in fields
    for (const ref of result.dropped) {
      expect(result.fields).not.toContain(ref);
    }
  });

  it('keeps fields present in catalog, drops those absent', async () => {
    // Only AcceptanceCriteria is present — VerificationMethod is absent
    const catalog = makeCatalog(['Microsoft.VSTS.Common.AcceptanceCriteria']);
    const svc = makeDiscoveryService(catalog);

    const result = await resolveAvailableReviewFields(svc, mockAuth, 'SomeProject', [], silentLogger);

    expect(result.fields).toContain('Microsoft.VSTS.Common.AcceptanceCriteria');
    expect(result.fields).not.toContain('Microsoft.VSTS.Common.VerificationMethod');
    expect(result.dropped).toContain('Microsoft.VSTS.Common.VerificationMethod');
    expect(result.dropped).not.toContain('Microsoft.VSTS.Common.AcceptanceCriteria');
  });

  it('includes env extras and per-call extras in the fetched list', async () => {
    // Catalog has Custom.A; Custom.B and Custom.C are absent
    const catalog = makeCatalog(['Custom.A']);
    const svc = makeDiscoveryService(catalog);

    const extras = ['Custom.A', 'Custom.B', 'Custom.C'];
    const result = await resolveAvailableReviewFields(svc, mockAuth, 'Proj', extras, silentLogger);

    expect(result.fields).toContain('Custom.A');
    expect(result.fields).not.toContain('Custom.B');
    expect(result.fields).not.toContain('Custom.C');
    expect(result.dropped).toContain('Custom.B');
    expect(result.dropped).toContain('Custom.C');
  });

  it('deduplicates extras that overlap with REVIEW_FIELDS or each other', async () => {
    const nonSystemRefs = (REVIEW_FIELDS as readonly string[]).filter((r) => !r.startsWith('System.'));
    // Include a REVIEW_FIELDS member as an extra — should not appear twice in fields
    const catalog = makeCatalog([...nonSystemRefs, 'Custom.A']);
    const svc = makeDiscoveryService(catalog);

    const duplicateExtra = nonSystemRefs[0];
    const extras = [duplicateExtra, 'Custom.A', duplicateExtra];
    const result = await resolveAvailableReviewFields(svc, mockAuth, 'Proj', extras, silentLogger);

    const count = result.fields.filter((f) => f === duplicateExtra).length;
    expect(count).toBe(1);
    expect(result.fields).toContain('Custom.A');
  });

  it('falls back to full requested set (including extras) when discover() throws', async () => {
    const client: FieldsClient = {
      listFields: vi.fn(),
      listWorkItemTypeFields: vi.fn(),
    } as unknown as FieldsClient;
    const svc = new FieldDiscoveryService(client);
    vi.spyOn(svc, 'discover').mockRejectedValue(new Error('network timeout'));
    const logger = { warn: vi.fn() };
    const extras = ['Custom.SPAWBS', 'Custom.SubModule'];

    const result = await resolveAvailableReviewFields(svc, mockAuth, undefined, extras, logger);

    // fields should be REVIEW_FIELDS ∪ extras (deduped)
    for (const ref of REVIEW_FIELDS) {
      expect(result.fields).toContain(ref);
    }
    expect(result.fields).toContain('Custom.SPAWBS');
    expect(result.fields).toContain('Custom.SubModule');
    expect(result.dropped).toHaveLength(0);
    expect(result.discoveryError).toMatch(/network timeout/);
  });

  it('falls back to full REVIEW_FIELDS and sets discoveryError when discover() throws', async () => {
    const client: FieldsClient = {
      listFields: vi.fn(),
      listWorkItemTypeFields: vi.fn(),
    } as unknown as FieldsClient;
    const svc = new FieldDiscoveryService(client);
    vi.spyOn(svc, 'discover').mockRejectedValue(new Error('network timeout'));
    const logger = { warn: vi.fn() };

    const result = await resolveAvailableReviewFields(svc, mockAuth, undefined, [], logger);

    expect(result.fields).toEqual([...REVIEW_FIELDS]);
    expect(result.dropped).toHaveLength(0);
    expect(result.discoveryError).toMatch(/network timeout/);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
