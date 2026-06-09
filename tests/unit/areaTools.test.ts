import { describe, it, expect, vi } from 'vitest';
import { FakeMcpServer, parseToolText } from '../helpers/fakeMcpServer.js';
import { registerAreaTools } from '../../src/mcp/tools/areaTools.js';
import type { ToolDeps } from '../../src/mcp/tools/registerTools.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import { createWrapTool } from '../../src/mcp/tools/toolHelpers.js';
import type { AppConfig } from '../../src/config/config.js';

const baseConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/Collection',
  adoApiVersion: '7.0',
  adoAuthMode: 'server_pat',
  adoPat: 'test-pat',
} as AppConfig;

function makeDeps(areaNodesClientMock: { getAreaTree: ReturnType<typeof vi.fn> }): ToolDeps {
  const logger = createSilentLogger();
  return {
    config: baseConfig,
    logger,
    wrapTool: createWrapTool(logger),
    adoClient: null as never,
    projectsClient: null as never,
    areaNodesClient: areaNodesClientMock as never,
    wiqlClient: null as never,
    workItemService: null as never,
    fieldDiscoveryService: null as never,
    linkTypeDiscoveryService: null as never,
    workItemTypesClient: null as never,
    metadataValidator: null as never,
    reviewScopeResolver: null as never,
    requirementReviewService: null as never,
    contextPacketService: null as never,
    completenessGapService: null as never,
    consistencyCandidateService: null as never,
    scopeSnapshotCache: null as never,
  };
}

const sampleTree = {
  id: 1,
  name: 'MyProject',
  path: '\\MyProject',
  structureType: 'area',
  hasChildren: true,
  children: [
    { id: 2, name: 'Sub-A', path: '\\MyProject\\Sub-A', structureType: 'area', hasChildren: false },
    {
      id: 3, name: 'Sub-B', path: '\\MyProject\\Sub-B', structureType: 'area', hasChildren: true,
      children: [
        { id: 4, name: 'Sub-B-1', path: '\\MyProject\\Sub-B\\Sub-B-1', structureType: 'area', hasChildren: false },
      ],
    },
  ],
};

describe('ado_get_area_tree', () => {
  it('returns isError when project is missing', async () => {
    const mock = { getAreaTree: vi.fn() };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    const result = await server.call('ado_get_area_tree', { depth: 5 });
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { warnings: string[] };
    expect(body.warnings[0]).toMatch(/project is required/i);
    expect(mock.getAreaTree).not.toHaveBeenCalled();
  });

  it('returns flat paths and raw tree on success', async () => {
    const mock = { getAreaTree: vi.fn().mockResolvedValue(sampleTree) };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    const result = await server.call('ado_get_area_tree', { project: 'MyProject', depth: 10 });
    const body = parseToolText(result) as { flatPaths: string[]; project: string; depth: number };

    expect(body.project).toBe('MyProject');
    expect(body.depth).toBe(10);
    expect(body.flatPaths).toContain('\\MyProject');
    expect(body.flatPaths).toContain('\\MyProject\\Sub-A');
    expect(body.flatPaths).toContain('\\MyProject\\Sub-B');
    expect(body.flatPaths).toContain('\\MyProject\\Sub-B\\Sub-B-1');
    expect(body.flatPaths).toHaveLength(4);
  });

  it('returns isError on client failure', async () => {
    const mock = { getAreaTree: vi.fn().mockRejectedValue(new Error('TFS 404')) };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    const result = await server.call('ado_get_area_tree', { project: 'MyProject' });
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { warnings: string[]; flatPaths: string[] };
    expect(body.warnings[0]).toMatch(/TFS 404/);
    expect(body.flatPaths).toHaveLength(0);
  });

  it('handles leaf-only tree (no children)', async () => {
    const leafTree = { id: 1, name: 'Root', path: '\\Root', structureType: 'area', hasChildren: false };
    const mock = { getAreaTree: vi.fn().mockResolvedValue(leafTree) };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    const result = await server.call('ado_get_area_tree', { project: 'Root' });
    const body = parseToolText(result) as { flatPaths: string[] };
    expect(body.flatPaths).toEqual(['\\Root']);
  });

  it('handles root node with missing path', async () => {
    const noPathTree = { id: 1, name: 'Root', structureType: 'area', hasChildren: false };
    const mock = { getAreaTree: vi.fn().mockResolvedValue(noPathTree) };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    const result = await server.call('ado_get_area_tree', { project: 'Root' });
    const body = parseToolText(result) as { flatPaths: string[] };
    expect(body.flatPaths).toHaveLength(0);
  });

  it('defaults depth to 10', async () => {
    const mock = { getAreaTree: vi.fn().mockResolvedValue(sampleTree) };
    const server = new FakeMcpServer();
    registerAreaTools(server.asMcpServer(), makeDeps(mock));

    await server.call('ado_get_area_tree', { project: 'MyProject' });
    expect(mock.getAreaTree).toHaveBeenCalledWith(expect.anything(), 'MyProject', 10);
  });
});
