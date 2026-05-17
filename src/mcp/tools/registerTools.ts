import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../../config/config.js';
import type { Logger } from '../../logging/logger.js';
import { AdoClient } from '../../ado/adoClient.js';
import { ProjectsClient } from '../../ado/projectsClient.js';
import { FieldsClient } from '../../ado/fieldsClient.js';
import { LinkTypesClient } from '../../ado/linkTypesClient.js';
import { WiqlClient } from '../../ado/wiqlClient.js';
import { WorkItemsClient } from '../../ado/workItemsClient.js';
import { QueriesClient } from '../../ado/queriesClient.js';
import { FieldDiscoveryService } from '../../services/fieldDiscoveryService.js';
import { LinkTypeDiscoveryService } from '../../services/linkTypeDiscoveryService.js';
import { WorkItemService } from '../../services/workItemService.js';
import { ReviewScopeResolver } from '../../services/reviewScopeResolver.js';
import { RequirementReviewService } from '../../services/requirementReviewService.js';
import { ContextPacketService } from '../../services/contextPacketService.js';
import { CompletenessGapService } from '../../services/completenessGapService.js';
import { ConsistencyCandidateService } from '../../services/consistencyCandidateService.js';
import { registerHealthTools } from './healthTools.js';
import { registerFieldTools } from './fieldTools.js';
import { registerLinkTypeTools } from './linkTypeTools.js';
import { registerScopeTools } from './scopeTools.js';
import { registerWorkItemTools } from './workItemTools.js';
import { registerReviewTools } from './reviewTools.js';
import { registerContextTools } from './contextTools.js';
import { registerDebugTools } from './debugTools.js';

export interface ToolDeps {
  config: AppConfig;
  logger: Logger;
  adoClient: AdoClient;
  projectsClient: ProjectsClient;
  wiqlClient: WiqlClient;
  workItemService: WorkItemService;
  fieldDiscoveryService: FieldDiscoveryService;
  linkTypeDiscoveryService: LinkTypeDiscoveryService;
  reviewScopeResolver: ReviewScopeResolver;
  requirementReviewService: RequirementReviewService;
  contextPacketService: ContextPacketService;
  completenessGapService: CompletenessGapService;
  consistencyCandidateService: ConsistencyCandidateService;
}

export function buildToolDeps(config: AppConfig, logger: Logger): ToolDeps {
  const adoClient = new AdoClient(config, logger);
  const projectsClient = new ProjectsClient(adoClient, config);
  const fieldsClient = new FieldsClient(adoClient, config);
  const linkTypesClient = new LinkTypesClient(adoClient, config);
  const wiqlClient = new WiqlClient(adoClient, config, logger);
  const workItemsClient = new WorkItemsClient(adoClient, config, logger);
  const queriesClient = new QueriesClient(adoClient, config);
  const fieldDiscoveryService = new FieldDiscoveryService(fieldsClient);
  const linkTypeDiscoveryService = new LinkTypeDiscoveryService(linkTypesClient);
  const workItemService = new WorkItemService(workItemsClient, config);
  const reviewScopeResolver = new ReviewScopeResolver(wiqlClient, config, logger, workItemService, queriesClient);
  const requirementReviewService = new RequirementReviewService();
  const contextPacketService = new ContextPacketService(workItemService, wiqlClient, config, logger);
  const completenessGapService = new CompletenessGapService();
  const consistencyCandidateService = new ConsistencyCandidateService();

  return {
    config,
    logger,
    adoClient,
    projectsClient,
    wiqlClient,
    workItemService,
    fieldDiscoveryService,
    linkTypeDiscoveryService,
    reviewScopeResolver,
    requirementReviewService,
    contextPacketService,
    completenessGapService,
    consistencyCandidateService,
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
}
