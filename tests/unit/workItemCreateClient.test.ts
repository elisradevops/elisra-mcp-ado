import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { AdoClient } from '../../src/ado/adoClient.js';
import { WorkItemCreateClient } from '../../src/ado/workItemCreateClient.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyz123456ABCDEFGH';
const AUTH: AuthContext = {
  mode: 'trusted_user_header',
  pat: FAKE_PAT,
  source: 'trusted_header',
  appUserId: 'alice',
};

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

const READ_ONLY_CONFIG = { ...BASE_CONFIG, adoReadOnly: true } as AppConfig;

const CREATED_WI_RESPONSE = {
  id: 1234,
  _links: {
    html: { href: 'https://tfs.example.local/tfs/DefaultCollection/MyProject/_workitems/edit/1234' },
    self: { href: 'https://tfs.example.local/tfs/DefaultCollection/_apis/wit/workitems/1234' },
  },
};

describe('WorkItemCreateClient — createOne', () => {
  let mock: MockAdapter;
  let axiosInst: ReturnType<typeof axios.create>;

  beforeEach(() => {
    axiosInst = axios.create({ validateStatus: null });
    mock = new MockAdapter(axiosInst);
  });

  afterEach(() => {
    mock.restore();
  });

  it('sends PATCH to the correct WIT URL with $Type prefix', async () => {
    mock
      .onPatch('https://tfs.example.local/tfs/DefaultCollection/MyProject/_apis/wit/workitems/%24Task')
      .reply(200, CREATED_WI_RESPONSE);

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    const result = await client.createOne('MyProject', 'Task', { title: 'New task' }, AUTH);
    expect(result.id).toBe(1234);
    expect(result.webUrl).toBe('https://tfs.example.local/tfs/DefaultCollection/MyProject/_workitems/edit/1234');
  });

  it('uses Content-Type application/json-patch+json', async () => {
    let capturedContentType = '';
    mock.onPatch().reply((config) => {
      capturedContentType = (config.headers as Record<string, string>)['Content-Type'] ?? '';
      return [200, CREATED_WI_RESPONSE];
    });

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    await client.createOne('MyProject', 'Task', { title: 'T' }, AUTH);
    expect(capturedContentType).toContain('application/json-patch+json');
  });

  it('includes System.Title in patch document', async () => {
    let body: unknown;
    mock.onPatch().reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, CREATED_WI_RESPONSE];
    });

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    await client.createOne('MyProject', 'Task', { title: 'My Task' }, AUTH);

    const patches = body as Array<{ op: string; path: string; value: unknown }>;
    const titlePatch = patches.find((p) => p.path === '/fields/System.Title');
    expect(titlePatch?.op).toBe('add');
    expect(titlePatch?.value).toBe('My Task');
  });

  it('includes only System.* and Microsoft.VSTS.* fields — no arbitrary fields', async () => {
    let body: unknown;
    mock.onPatch().reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, CREATED_WI_RESPONSE];
    });

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    // Pass extra fields beyond NormalizedWorkItemInput — they should not appear in patch
    await client.createOne('MyProject', 'Task', { title: 'T', description: 'D' }, AUTH);

    const patches = body as Array<{ path: string }>;
    for (const patch of patches) {
      expect(
        patch.path.startsWith('/fields/System.') || patch.path.startsWith('/fields/Microsoft.VSTS'),
      ).toBe(true);
    }
  });

  it('omits optional fields when not provided', async () => {
    let body: unknown;
    mock.onPatch().reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, CREATED_WI_RESPONSE];
    });

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    await client.createOne('MyProject', 'Task', { title: 'T' }, AUTH);

    const patches = body as Array<{ path: string }>;
    const paths = patches.map((p) => p.path);
    expect(paths).not.toContain('/fields/System.AreaPath');
    expect(paths).not.toContain('/fields/System.IterationPath');
    expect(paths).not.toContain('/fields/System.Tags');
    expect(paths).not.toContain('/fields/Microsoft.VSTS.Common.Priority');
  });

  it('includes AreaPath and Priority when provided', async () => {
    let body: unknown;
    mock.onPatch().reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, CREATED_WI_RESPONSE];
    });

    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());
    await client.createOne('MyProject', 'Task', { title: 'T', areaPath: 'MyProject\\Team', priority: 2 }, AUTH);

    const patches = body as Array<{ path: string; value: unknown }>;
    const area = patches.find((p) => p.path === '/fields/System.AreaPath');
    const priority = patches.find((p) => p.path === '/fields/Microsoft.VSTS.Common.Priority');
    expect(area?.value).toBe('MyProject\\Team');
    expect(priority?.value).toBe(2);
  });

  it('blocks PATCH when adoReadOnly=true', async () => {
    mock.onPatch().reply(200, CREATED_WI_RESPONSE);
    const adoClient = new AdoClient(READ_ONLY_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, READ_ONLY_CONFIG, createSilentLogger());

    await expect(
      client.createOne('MyProject', 'Task', { title: 'T' }, AUTH),
    ).rejects.toThrow('ADO_READ_ONLY=true');
  });

  it('does not expose PAT in thrown error message', async () => {
    mock.onPatch().reply(401, { message: 'Unauthorized' });
    const adoClient = new AdoClient(BASE_CONFIG, createSilentLogger(), axiosInst);
    const client = new WorkItemCreateClient(adoClient, BASE_CONFIG, createSilentLogger());

    try {
      await client.createOne('MyProject', 'Task', { title: 'T' }, AUTH);
      throw new Error('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(FAKE_PAT);
    }
  });
});
