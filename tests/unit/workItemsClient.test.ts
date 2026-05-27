import { describe, it, expect, vi } from 'vitest';
import { WorkItemsClient } from '../../src/ado/workItemsClient.js';
import type { AdoClient } from '../../src/ado/adoClient.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const AUTH: AuthContext = { mode: 'per_request_pat', pat: 'test-pat' };

function makeConfig(adoApiVersion: string): AppConfig {
  return {
    adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
    adoApiVersion,
    adoBatchSize: 200,
    adoAuthMode: 'per_request_pat',
    adoReadOnly: true,
    adoEnableDebugOutput: false,
    adoRequestTimeoutMs: 5000,
    adoAllowUnknownFields: false,
    adoPageSizeDefault: 50,
    adoPageSizeMax: 200,
    adoScopeCacheTtlMs: 600000,
    adoScopeCacheMaxEntries: 50,
    logLevel: 'silent' as unknown as AppConfig['logLevel'],
    mcpoApiKey: undefined,
    adoPat: undefined,
  };
}

const STUB_ITEM = { id: 1, rev: 1, fields: { 'System.Id': 1, 'System.Title': 'Test' }, relations: undefined };

function makeAdoClient(response: unknown) {
  return {
    request: vi.fn().mockResolvedValue(response),
    get: vi.fn().mockResolvedValue(response),
  } as unknown as AdoClient;
}

describe('WorkItemsClient.fetchBatch', () => {
  it('returns empty array when ids is empty', async () => {
    const client = makeAdoClient({ value: [] });
    const wic = new WorkItemsClient(client, makeConfig('7.0'));
    const result = await wic.fetchBatch([], AUTH);
    expect(result).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('throws RangeError when ids exceed 200', async () => {
    const client = makeAdoClient({ value: [] });
    const wic = new WorkItemsClient(client, makeConfig('7.0'));
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(wic.fetchBatch(ids, AUTH)).rejects.toThrow(RangeError);
  });

  describe('ADO_API_VERSION = 7.0 (POST workitemsbatch path)', () => {
    it('calls POST workitemsbatch', async () => {
      const client = makeAdoClient({ value: [{ id: 1 }] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await wic.fetchBatch([1, 2], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.method).toBe('POST');
      expect(call.url).toContain('workitemsbatch');
    });

    it('includes ids in request body', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM, STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await wic.fetchBatch([10, 20], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.data).toMatchObject({ ids: [10, 20] });
    });

    it('includes fields in request body when provided', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await wic.fetchBatch([1], AUTH, ['System.Id', 'System.Title']);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.data).toMatchObject({ fields: ['System.Id', 'System.Title'] });
    });

    it('uses GET path (not POST workitemsbatch) when expand is relations', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await wic.fetchBatch([1], AUTH, undefined, 'relations');

      const call = vi.mocked(client.request).mock.calls[0][0];
      // Fix D: $expand=relations must go through GET to avoid on-prem batch 500
      expect(call.method).toBe('GET');
      expect(call.params?.['$expand']).toBe('relations');
    });

    it('sets apiVersionFallback: true', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await wic.fetchBatch([1], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.apiVersionFallback).toBe(true);
    });

    it('throws when ADO returns 0 items for non-empty ids (Fix C)', async () => {
      const client = makeAdoClient({ value: [] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      await expect(wic.fetchBatch([1, 2], AUTH)).rejects.toThrow('ADO returned 0 of 2 requested items');
    });

    it('does not throw on empty result when allowEmptyResult=true', async () => {
      const client = makeAdoClient({ value: [] });
      const wic = new WorkItemsClient(client, makeConfig('7.0'));
      const result = await wic.fetchBatch([1], AUTH, undefined, undefined, undefined, true);
      expect(result).toEqual([]);
    });
  });

  describe('ADO_API_VERSION = 4.1 (TFS 2018 GET path)', () => {
    it('calls GET workitems endpoint instead of POST workitemsbatch', async () => {
      const client = makeAdoClient({ value: [{ id: 1 }] });
      const wic = new WorkItemsClient(client, makeConfig('4.1'));
      await wic.fetchBatch([1, 2], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.method).toBe('GET');
      expect(call.url).toMatch(/\/workitems$/);
      expect(call.url).not.toContain('workitemsbatch');
    });

    it('encodes ids as comma-separated query param', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM, STUB_ITEM, STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('4.1'));
      await wic.fetchBatch([10, 20, 30], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.params?.['ids']).toBe('10,20,30');
    });

    it('encodes fields as comma-separated query param', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('4.1'));
      await wic.fetchBatch([1], AUTH, ['System.Id', 'System.Title']);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.params?.['fields']).toBe('System.Id,System.Title');
    });

    it('includes $expand query param when expand is relations', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('4.1'));
      await wic.fetchBatch([1], AUTH, undefined, 'relations');

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.params?.['$expand']).toBe('relations');
    });

    it('sets apiVersionFallback: true', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('4.1'));
      await wic.fetchBatch([1], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.apiVersionFallback).toBe(true);
    });
  });

  describe('ADO_API_VERSION = 5.0 (first batch-capable version)', () => {
    it('uses POST workitemsbatch when no expand', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('5.0'));
      await wic.fetchBatch([1], AUTH);

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.method).toBe('POST');
      expect(call.url).toContain('workitemsbatch');
    });

    it('uses GET path when expand is relations (Fix D)', async () => {
      const client = makeAdoClient({ value: [STUB_ITEM] });
      const wic = new WorkItemsClient(client, makeConfig('5.0'));
      await wic.fetchBatch([1], AUTH, undefined, 'relations');

      const call = vi.mocked(client.request).mock.calls[0][0];
      expect(call.method).toBe('GET');
      expect(call.url).not.toContain('workitemsbatch');
      expect(call.params?.['$expand']).toBe('relations');
    });
  });
});

describe('WorkItemsClient.fetchSingle', () => {
  it('calls GET workitems/:id', async () => {
    const client = makeAdoClient({ id: 42 });
    const wic = new WorkItemsClient(client, makeConfig('7.0'));
    await wic.fetchSingle(42, AUTH);

    const call = vi.mocked(client.request).mock.calls[0][0];
    expect(call.method).toBe('GET');
    expect(call.url).toContain('/workitems/42');
  });

  it('sets apiVersionFallback: true', async () => {
    const client = makeAdoClient({ id: 42 });
    const wic = new WorkItemsClient(client, makeConfig('7.0'));
    await wic.fetchSingle(42, AUTH);

    const call = vi.mocked(client.request).mock.calls[0][0];
    expect(call.apiVersionFallback).toBe(true);
  });
});
