import { describe, it, expect, vi } from 'vitest';
import { AreaNodesClient } from '../../src/ado/areaNodesClient.js';
import type { AdoClient } from '../../src/ado/adoClient.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const AUTH: AuthContext = { mode: 'per_request_pat', pat: 'test-pat' };

const baseConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/Collection',
  adoApiVersion: '7.0',
} as AppConfig;

function makeClient(requestMock: ReturnType<typeof vi.fn>) {
  return {
    request: requestMock,
    buildUrl: (...segments: string[]) =>
      `https://tfs.example.com/tfs/Collection/${segments.join('/').replace(/\/+/g, '/')}`,
  } as unknown as AdoClient;
}

describe('AreaNodesClient', () => {
  it('builds project-scoped URL', async () => {
    const requestMock = vi.fn().mockResolvedValue({ id: 1, name: 'Root', path: '\\Project', structureType: 'area', hasChildren: false });
    const client = new AreaNodesClient(makeClient(requestMock), baseConfig);

    await client.getAreaTree(AUTH, 'MyProject', 5);

    expect(requestMock).toHaveBeenCalledOnce();
    const opts = requestMock.mock.calls[0][0];
    expect(opts.url).toBe('https://tfs.example.com/tfs/Collection/MyProject/_apis/wit/classificationnodes/areas');
  });

  it('passes $depth param', async () => {
    const requestMock = vi.fn().mockResolvedValue({ id: 1, name: 'Root', path: '\\Project', structureType: 'area', hasChildren: false });
    const client = new AreaNodesClient(makeClient(requestMock), baseConfig);

    await client.getAreaTree(AUTH, 'MyProject', 7);

    const opts = requestMock.mock.calls[0][0];
    expect(opts.params['$depth']).toBe(7);
  });

  it('enables apiVersionFallback', async () => {
    const requestMock = vi.fn().mockResolvedValue({ id: 1, name: 'Root', path: '\\Project', structureType: 'area', hasChildren: false });
    const client = new AreaNodesClient(makeClient(requestMock), baseConfig);

    await client.getAreaTree(AUTH, 'MyProject');

    const opts = requestMock.mock.calls[0][0];
    expect(opts.apiVersionFallback).toBe(true);
  });

  it('defaults depth to 10', async () => {
    const requestMock = vi.fn().mockResolvedValue({ id: 1, name: 'Root', path: '\\Project', structureType: 'area', hasChildren: false });
    const client = new AreaNodesClient(makeClient(requestMock), baseConfig);

    await client.getAreaTree(AUTH, 'MyProject');

    const opts = requestMock.mock.calls[0][0];
    expect(opts.params['$depth']).toBe(10);
  });

  it('returns the node from adoClient', async () => {
    const node = { id: 42, name: 'Areas', path: '\\MyProject\\Area Paths', structureType: 'area', hasChildren: true };
    const requestMock = vi.fn().mockResolvedValue(node);
    const client = new AreaNodesClient(makeClient(requestMock), baseConfig);

    const result = await client.getAreaTree(AUTH, 'MyProject');
    expect(result).toEqual(node);
  });
});
