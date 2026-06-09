import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../../config/config.js';
import type { Logger } from '../../logging/logger.js';
import { AdoClient } from '../../ado/adoClient.js';
import { ProjectsClient } from '../../ado/projectsClient.js';
import { AreaNodesClient } from '../../ado/areaNodesClient.js';
import { FieldsClient } from '../../ado/fieldsClient.js';
import { LinkTypesClient } from '../../ado/linkTypesClient.js';
import { WorkItemTypesClient } from '../../ado/workItemTypesClient.js';
import { WiqlClient } from '../../ado/wiqlClient.js';
import { WorkItemsClient } from '../../ado/workItemsClient.js';
import { QueriesClient } from '../../ado/queriesClient.js';
import { FieldDiscoveryService } from '../../services/fieldDiscoveryService.js';
import { LinkTypeDiscoveryService } from '../../services/linkTypeDiscoveryService.js';
import { MetadataValidator } from '../../services/metadataValidator.js';
import { WorkItemService } from '../../services/workItemService.js';
import { ReviewScopeResolver } from '../../services/reviewScopeResolver.js';
import { RequirementReviewService } from '../../services/requirementReviewService.js';
import { ContextPacketService } from '../../services/contextPacketService.js';
import { CompletenessGapService } from '../../services/completenessGapService.js';
import { ConsistencyCandidateService } from '../../services/consistencyCandidateService.js';
import { ScopeSnapshotCache } from '../../services/scopeSnapshotCache.js';
import { registerHealthTools } from './healthTools.js';
import { registerFieldTools } from './fieldTools.js';
import { registerLinkTypeTools } from './linkTypeTools.js';
import { registerScopeTools } from './scopeTools.js';
import { registerWorkItemTools } from './workItemTools.js';
import { registerReviewTools } from './reviewTools.js';
import { registerContextTools } from './contextTools.js';
import { registerDebugTools } from './debugTools.js';
import { registerAreaTools } from './areaTools.js';
import { createWrapTool, type ToolResult } from './toolHelpers.js';
import { WriteApprovalStore } from '../../approvals/writeApprovalStore.js';
import { WorkItemCreateClient } from '../../ado/workItemCreateClient.js';
import { registerWriteTools } from './writeTools.js';

export type { ToolResult };

export interface ToolDeps {
  config: AppConfig;
  logger: Logger;
  /** Wrap a tool handler with per-call requestId generation, context propagation, and start log. */
  wrapTool: ReturnType<typeof createWrapTool>;
  adoClient: AdoClient;
  projectsClient: ProjectsClient;
  areaNodesClient: AreaNodesClient;
  wiqlClient: WiqlClient;
  workItemService: WorkItemService;
  fieldDiscoveryService: FieldDiscoveryService;
  linkTypeDiscoveryService: LinkTypeDiscoveryService;
  workItemTypesClient: WorkItemTypesClient;
  metadataValidator: MetadataValidator;
  reviewScopeResolver: ReviewScopeResolver;
  requirementReviewService: RequirementReviewService;
  contextPacketService: ContextPacketService;
  completenessGapService: CompletenessGapService;
  consistencyCandidateService: ConsistencyCandidateService;
  scopeSnapshotCache: ScopeSnapshotCache;
  writeApprovalStore?: WriteApprovalStore;
  workItemCreateClient?: WorkItemCreateClient;
}

export interface P2Deps {
  writeApprovalStore: WriteApprovalStore;
}

export function buildToolDeps(config: AppConfig, logger: Logger, p2?: P2Deps): ToolDeps {
  const wrapTool = createWrapTool(logger);
  const adoClient = new AdoClient(config, logger);
  const projectsClient = new ProjectsClient(adoClient, config);
  const areaNodesClient = new AreaNodesClient(adoClient, config);
  const fieldsClient = new FieldsClient(adoClient, config);
  const linkTypesClient = new LinkTypesClient(adoClient, config);
  const wiqlClient = new WiqlClient(adoClient, config, logger);
  const workItemsClient = new WorkItemsClient(adoClient, config, logger);
  const queriesClient = new QueriesClient(adoClient, config);
  const workItemTypesClient = new WorkItemTypesClient(adoClient, config);
  const fieldDiscoveryService = new FieldDiscoveryService(fieldsClient);
  const linkTypeDiscoveryService = new LinkTypeDiscoveryService(linkTypesClient);
  const metadataValidator = new MetadataValidator(fieldsClient, linkTypesClient, workItemTypesClient);
  const workItemService = new WorkItemService(workItemsClient, config, fieldDiscoveryService);
  const reviewScopeResolver = new ReviewScopeResolver(wiqlClient, config, logger, workItemService, queriesClient);
  const requirementReviewService = new RequirementReviewService();
  const contextPacketService = new ContextPacketService(workItemService, wiqlClient, config, logger);
  const completenessGapService = new CompletenessGapService();
  const consistencyCandidateService = new ConsistencyCandidateService();
  const scopeSnapshotCache = new ScopeSnapshotCache(config.adoScopeCacheTtlMs, config.adoScopeCacheMaxEntries);
  const workItemCreateClient = p2
    ? new WorkItemCreateClient(adoClient, config, logger)
    : undefined;

  return {
    config,
    logger,
    wrapTool,
    adoClient,
    projectsClient,
    areaNodesClient,
    wiqlClient,
    workItemService,
    fieldDiscoveryService,
    linkTypeDiscoveryService,
    workItemTypesClient,
    metadataValidator,
    reviewScopeResolver,
    requirementReviewService,
    contextPacketService,
    completenessGapService,
    consistencyCandidateService,
    scopeSnapshotCache,
    writeApprovalStore: p2?.writeApprovalStore,
    workItemCreateClient,
  };
}

export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  registerHealthTools(server, deps);
  registerFieldTools(server, deps);
  registerLinkTypeTools(server, deps);
  registerScopeTools(server, deps);
  registerWorkItemTools(server, deps);
  registerReviewTools(server, deps);
  registerContextTools(server, deps);
  registerDebugTools(server, deps);
  registerAreaTools(server, deps);
  registerWriteTools(server, deps);
}
