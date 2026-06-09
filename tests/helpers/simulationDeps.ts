import { vi } from 'vitest';
import type { IWiqlClient, WiqlExecuteOptions, WiqlResult } from '../../src/ado/wiqlClient.js';
import type { IWorkItemsClient } from '../../src/ado/workItemsClient.js';
import type { ToolDeps } from '../../src/mcp/tools/registerTools.js';
import type { AdoWorkItem } from '../../src/types/ado.js';
import type { AppConfig } from '../../src/config/config.js';
import { ReviewScopeResolver } from '../../src/services/reviewScopeResolver.js';
import { RequirementReviewService } from '../../src/services/requirementReviewService.js';
import { ScopeSnapshotCache } from '../../src/services/scopeSnapshotCache.js';
import { CompletenessGapService } from '../../src/services/completenessGapService.js';
import { ConsistencyCandidateService } from '../../src/services/consistencyCandidateService.js';
import { WorkItemService } from '../../src/services/workItemService.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import { WiqlClient } from '../../src/ado/wiqlClient.js';

export interface SimulationDepsOptions {
  customerAreaPath: string;
  systemAreaPath: string;
  customerIds: number[];
  systemIds: number[];
  itemMap: Map<number, AdoWorkItem>;
  pageSize?: number;
}

export function buildSimulationConfig(pageSize = 25): AppConfig {
  return {
    adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
    adoApiVersion: '7.0',
    adoBatchSize: 200,
    adoAuthMode: 'per_request_pat',
    adoReadOnly: true,
    adoEnableDebugOutput: false,
    adoRequestTimeoutMs: 5000,
    adoAllowUnknownFields: false,
    adoPageSizeDefault: pageSize,
    adoPageSizeMax: 200,
    adoScopeCacheTtlMs: 600_000,
    adoScopeCacheMaxEntries: 50,
    adoReviewExtraFields: [],
    adoTraceabilityLinkTokens: ['Affects', 'CoveredBy', 'TestedBy'],
  };
}

export function buildSimulationDeps(opts: SimulationDepsOptions): {
  deps: ToolDeps;
  wiqlClient: IWiqlClient;
} {
  const config = buildSimulationConfig(opts.pageSize);
  const logger = createSilentLogger();

  const wiqlClient: IWiqlClient = {
    execute: vi.fn().mockImplementation(async (o: WiqlExecuteOptions): Promise<WiqlResult> => {
      if (o.wiql.includes(opts.customerAreaPath)) {
        return { ids: opts.customerIds, sourceIds: opts.customerIds, targetIds: [], totalMatched: opts.customerIds.length, queryType: 'flat', wiqlMaybeTruncated: false };
      }
      if (o.wiql.includes(opts.systemAreaPath)) {
        return { ids: opts.systemIds, sourceIds: opts.systemIds, targetIds: [], totalMatched: opts.systemIds.length, queryType: 'flat', wiqlMaybeTruncated: false };
      }
      throw new Error(`Unexpected WIQL in simulation: ${o.wiql}`);
    }),
  };

  const fakeClient: IWorkItemsClient = {
    fetchBatch: vi.fn().mockImplementation(
      async (ids: number[], _auth: unknown, _fields: unknown, expand: string | undefined) => {
        return ids.map((id) => {
          const item = opts.itemMap.get(id);
          if (!item) return null;
          if (!expand || expand !== 'relations') {
            return { ...item, relations: undefined };
          }
          return item;
        }).filter((i): i is AdoWorkItem => i !== null);
      }
    ),
    fetchSingle: vi.fn().mockImplementation(
      async (id: number, _auth: unknown, _fields: unknown, expand: string | undefined) => {
        const item = opts.itemMap.get(id);
        if (!item) throw new Error(`Item ${id} not found`);
        if (!expand || expand !== 'relations') {
          return { ...item, relations: undefined };
        }
        return item;
      }
    ),
  };

  const workItemService = new WorkItemService(fakeClient, config);
  const scopeSnapshotCache = new ScopeSnapshotCache(config.adoScopeCacheTtlMs, config.adoScopeCacheMaxEntries);
  const reviewScopeResolver = new ReviewScopeResolver(wiqlClient, config, logger, workItemService, null as never);

  const fieldDiscoveryService = {
    discover: vi.fn().mockRejectedValue(new Error('mock — no field discovery')),
  };

  const metadataValidator = {
    validate: vi.fn().mockResolvedValue({ ok: true }),
  };

  const deps: ToolDeps = {
    config,
    logger,
    adoClient: null as never,
    projectsClient: null as never,
    areaNodesClient: null as never,
    wiqlClient: wiqlClient as unknown as WiqlClient,
    workItemService,
    fieldDiscoveryService: fieldDiscoveryService as never,
    linkTypeDiscoveryService: null as never,
    workItemTypesClient: null as never,
    metadataValidator: metadataValidator as never,
    reviewScopeResolver,
    requirementReviewService: new RequirementReviewService(),
    contextPacketService: null as never,
    completenessGapService: new CompletenessGapService(),
    consistencyCandidateService: new ConsistencyCandidateService(),
    scopeSnapshotCache,
  };

  return { deps, wiqlClient };
}
