import { describe, it, expect, vi } from 'vitest';
import { FieldDiscoveryService } from '../../src/services/fieldDiscoveryService.js';
import type { FieldsClient } from '../../src/ado/fieldsClient.js';
import type { AdoFieldDefinition } from '../../src/types/ado.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const mockAuth: AuthContext = { mode: 'per_request_pat', pat: 'test-pat' };

function makeField(overrides: Partial<AdoFieldDefinition> & { referenceName: string; name: string; type: string }): AdoFieldDefinition {
  return {
    readOnly: false,
    isIdentity: false,
    isPickList: false,
    ...overrides,
  };
}

function makeFieldsClient(fields: AdoFieldDefinition[], witFields: AdoFieldDefinition[] = []): FieldsClient {
  return {
    listFields: vi.fn().mockResolvedValue(fields),
    listWorkItemTypeFields: vi.fn().mockResolvedValue(witFields),
  } as unknown as FieldsClient;
}

describe('FieldDiscoveryService — basic discovery', () => {
  it('returns discovered fields from ADO', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
      makeField({ referenceName: 'System.Title', name: 'Title', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('System.Id')).toBeDefined();
    expect(catalog.get('System.Title')).toBeDefined();
    expect(catalog.get('System.Id')!.source).toBe('discovered');
  });

  it('merges seed DocGen hints into discovered fields', async () => {
    // System.AreaPath is in the seed catalog with knownInDocGen: true
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.AreaPath', name: 'Area Path', type: 'treePath' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    const entry = catalog.get('System.AreaPath')!;
    expect(entry).toBeDefined();
    expect(entry.source).toBe('discovered');
    expect(entry.knownInDocGen).toBe(true);
    expect(entry.safeForFiltering).toBe(true);
    expect(entry.safeForGrouping).toBe(true);
  });

  it('keeps seed-only fields in catalog with source=seed', async () => {
    // Return only System.Id from ADO — seed has many more fields
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    // System.Title is in seed but not in ADO response
    const seedOnly = catalog.get('System.Title');
    expect(seedOnly).toBeDefined();
    expect(seedOnly!.source).toBe('seed');
  });

  it('adds custom fields from ADO not in seed', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'Custom.NewField', name: 'New Field', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    const entry = catalog.get('Custom.NewField')!;
    expect(entry).toBeDefined();
    expect(entry.isCustom).toBe(true);
    expect(entry.source).toBe('discovered');
    expect(entry.knownInDocGen).toBe(false);
  });

  it('maps treePath type correctly', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.IterationPath', name: 'Iteration Path', type: 'treePath' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    const entry = catalog.get('System.IterationPath')!;
    expect(entry.isTreePath).toBe(true);
    expect(entry.allowedOperators).toContain('UNDER');
    expect(entry.allowedOperators).not.toContain('CONTAINS');
  });

  it('maps html type correctly — CONTAINS only', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Description', name: 'Description', type: 'html' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    const entry = catalog.get('System.Description')!;
    expect(entry.isLongText).toBe(true);
    expect(entry.allowedOperators).toEqual(['CONTAINS']);
  });

  it('maps boolean type — only = and <>', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.IsDeleted', name: 'Is Deleted', type: 'boolean' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    const entry = catalog.get('System.IsDeleted')!;
    expect(entry.allowedOperators).toEqual(['=', '<>']);
  });
});

describe('FieldDiscoveryService — case-insensitive lookup', () => {
  it('resolves Custom.CustomerId to Custom.CustomerID canonical ref', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'Custom.CustomerID', name: 'Customer ID', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('Custom.CustomerId')).toBeDefined();
    expect(catalog.getCanonicalKey('Custom.CustomerId')).toBe('Custom.CustomerID');
  });

  it('resolves mixed-case system fields', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.State', name: 'State', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('system.state')).toBeDefined();
    expect(catalog.get('SYSTEM.STATE')).toBeDefined();
  });
});

describe('FieldDiscoveryService — caching', () => {
  it('calls listFields only once for repeated calls', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth });

    expect(client.listFields).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expires', async () => {
    let now = 0;
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client, () => now);

    await svc.discover({ auth: mockAuth });
    now = 60 * 60 * 1_000 + 1; // past TTL
    await svc.discover({ auth: mockAuth });

    expect(client.listFields).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-fetch before TTL expires', async () => {
    let now = 0;
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client, () => now);

    await svc.discover({ auth: mockAuth });
    now = 60 * 60 * 1_000 - 1; // 1ms before expiry
    await svc.discover({ auth: mockAuth });

    expect(client.listFields).toHaveBeenCalledTimes(1);
  });

  it('refresh=true forces re-fetch regardless of TTL', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    await svc.discover({ auth: mockAuth, refresh: true });

    expect(client.listFields).toHaveBeenCalledTimes(2);
  });

  it('invalidate() clears cache', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
    ]);
    const svc = new FieldDiscoveryService(client);

    await svc.discover({ auth: mockAuth });
    svc.invalidate();
    await svc.discover({ auth: mockAuth });

    expect(client.listFields).toHaveBeenCalledTimes(2);
  });
});

describe('FieldDiscoveryService — workItemType filter', () => {
  it('filters catalog to WIT-applicable fields', async () => {
    const client = makeFieldsClient(
      [
        makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
        makeField({ referenceName: 'System.Title', name: 'Title', type: 'string' }),
        makeField({ referenceName: 'Custom.OnlyOnReq', name: 'Only On Req', type: 'string' }),
      ],
      // WIT fields endpoint returns only these two:
      [
        makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
        makeField({ referenceName: 'System.Title', name: 'Title', type: 'string' }),
      ]
    );
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({
      auth: mockAuth,
      project: 'MyProject',
      workItemType: 'Requirement',
    });

    expect(catalog.get('System.Id')).toBeDefined();
    expect(catalog.get('System.Title')).toBeDefined();
    expect(catalog.get('Custom.OnlyOnReq')).toBeUndefined();
  });

  it('calls listWorkItemTypeFields with correct project and WIT', async () => {
    const client = makeFieldsClient(
      [makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' })],
      [makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' })]
    );
    const svc = new FieldDiscoveryService(client);
    await svc.discover({ auth: mockAuth, project: 'MyProject', workItemType: 'Bug' });

    expect(client.listWorkItemTypeFields).toHaveBeenCalledWith(mockAuth, 'MyProject', 'Bug');
  });

  it('returns full catalog when workItemType omitted', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Id', name: 'ID', type: 'integer' }),
      makeField({ referenceName: 'System.Title', name: 'Title', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(client.listWorkItemTypeFields).not.toHaveBeenCalled();
    expect(catalog.get('System.Id')).toBeDefined();
    expect(catalog.get('System.Title')).toBeDefined();
  });
});

describe('FieldDiscoveryService — field defaults', () => {
  it('html field defaults safeForFiltering=false', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'Custom.LongField', name: 'Long', type: 'html' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('Custom.LongField')!.safeForFiltering).toBe(false);
  });

  it('seed safeForFiltering overrides default for discovered fields', async () => {
    // System.Description is html but seed marks safeForFiltering=true
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.Description', name: 'Description', type: 'html' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    // Seed says safeForFiltering: true for Description
    expect(catalog.get('System.Description')!.safeForFiltering).toBe(true);
  });

  it('Elisra prefix → isCustom=true', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'Elisra.TestPhase', name: 'Test Phase', type: 'string' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('Elisra.TestPhase')!.isCustom).toBe(true);
  });

  it('identity type → isIdentity=true', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'System.AssignedTo', name: 'Assigned To', type: 'identity' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('System.AssignedTo')!.isIdentity).toBe(true);
  });

  it('unknown ADO type falls back to string', async () => {
    const client = makeFieldsClient([
      makeField({ referenceName: 'Custom.Weird', name: 'Weird', type: 'someFutureType' }),
    ]);
    const svc = new FieldDiscoveryService(client);
    const catalog = await svc.discover({ auth: mockAuth });

    expect(catalog.get('Custom.Weird')!.type).toBe('string');
  });
});
