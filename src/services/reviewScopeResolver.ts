import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { AuthContext } from '../auth/authContext.js';
import type { IWiqlClient } from '../ado/wiqlClient.js';
import type { IQueriesClient } from '../ado/queriesClient.js';
import type { ReviewScope, ScopeResolution } from '../domain/reviewScope.js';
import type { FieldFilter, FilterNode, OrderBy } from '../domain/fieldFilter.js';
import type { WorkItemService } from './workItemService.js';
import { createDefaultCompiler } from '../domain/genericWiqlCompiler.js';
import { isWorkItemRel } from '../domain/adoLinkTypes.js';

// GUARDRAIL: BFS depth and breadth caps prevent unbounded ADO API calls. See docs/performance.md.
const MAX_DEPTH = 3;
const MAX_BREADTH_PER_LEVEL = 100;

export class ReviewScopeResolver {
  constructor(
    private readonly wiqlClient: IWiqlClient,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly workItemService?: WorkItemService,
    private readonly queriesClient?: IQueriesClient
  ) {}

  async resolve(scope: ReviewScope, overrideAuth?: AuthContext): Promise<ScopeResolution> {
    const auth = overrideAuth ?? scope.auth ?? this.noAuth();
    const { source } = scope;

    switch (source.type) {
      case 'wiql':
        return this.resolveWiql(scope.project, source.wiql, auth);

      case 'ids':
        return this.resolveIds(source.ids);

      case 'fieldFilters':
        return this.resolveFieldFilters(scope.project, source.filters, source.filterTree, source.orderBy, source.asOf, auth);

      case 'linkQuery':
        return this.resolveLinkQuery(scope.project, source, auth);

      case 'linkedItems':
        return this.resolveLinkedItems(scope.project, source.rootId, source.relationTypes, source.depth, auth);

      case 'savedQuery':
        return this.resolveSavedQuery(scope.project, source.queryPathOrId, auth);
    }
  }

  // ─── Wiql source ────────────────────────────────────────────────────────────

  private async resolveWiql(
    project: string | undefined,
    wiql: string,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!project) {
      throw projectRequired('wiql');
    }

    this.logger.debug({ project, sourceType: 'wiql' }, 'Resolving WIQL scope');

    const result = await this.wiqlClient.execute({ project, wiql, auth });

    const resolution: ScopeResolution = {
      project,
      sourceType: 'wiql',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings: [],
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
  }

  // ─── IDs source ─────────────────────────────────────────────────────────────

  private resolveIds(ids: number[]): ScopeResolution {
    const warnings: string[] = [];
    const valid: number[] = [];

    for (const id of ids) {
      if (!Number.isInteger(id) || id <= 0) {
        warnings.push(`Skipped invalid work item ID: ${id}`);
      } else {
        valid.push(id);
      }
    }

    if (valid.length === 0) {
      throw new Error('ids source: no valid work item IDs provided (all were <= 0 or non-integer).');
    }

    // Deduplicate, preserve order
    const seen = new Set<number>();
    const deduped: number[] = [];
    for (const id of valid) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }
    if (deduped.length < valid.length) {
      warnings.push(`Removed ${valid.length - deduped.length} duplicate work item ID(s).`);
    }

    return {
      sourceType: 'ids',
      ids: deduped,
      totalMatched: deduped.length,
      warnings,
    };
  }

  // ─── FieldFilters source ────────────────────────────────────────────────────

  private async resolveFieldFilters(
    project: string | undefined,
    filters: FieldFilter[] | undefined,
    filterTree: FilterNode | undefined,
    orderBy: OrderBy[] | undefined,
    asOf: string | undefined,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!project) {
      throw projectRequired('fieldFilters');
    }

    const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields);
    const { wiql, warnings } = compiler.compile({ project, filters, filterTree, orderBy, asOf });

    this.logger.debug(
      { project, sourceType: 'fieldFilters', usingFilterTree: !!filterTree, filterCount: filters?.length ?? 0 },
      'Resolving fieldFilters scope'
    );

    const result = await this.wiqlClient.execute({ project, wiql, auth });

    const resolution: ScopeResolution = {
      project,
      sourceType: 'fieldFilters',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings,
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
  }

  // ─── SavedQuery source ───────────────────────────────────────────────────────

  private async resolveSavedQuery(
    project: string | undefined,
    idOrPath: string,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!project) {
      throw projectRequired('savedQuery');
    }
    if (!this.queriesClient) {
      throw new AdoScopeError(
        'savedQuery source requires QueriesClient to be injected into ReviewScopeResolver.',
        'CONFIGURATION_ERROR'
      );
    }

    this.logger.debug({ project, idOrPath }, 'Resolving savedQuery scope');

    const queryDef = await this.queriesClient.getQueryById(auth, project, idOrPath);

    if (queryDef.queryType !== 'flat') {
      throw new AdoScopeError(
        `Saved query "${queryDef.name}" is a "${queryDef.queryType}" query. ` +
        `Only flat queries are supported via savedQuery source. ` +
        `Use source.type="wiql" for link/tree queries.`,
        'UNSUPPORTED_QUERY_TYPE'
      );
    }

    const result = await this.wiqlClient.execute({ project, wiql: queryDef.wiql, auth });

    const resolution: ScopeResolution = {
      project,
      sourceType: 'savedQuery',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings: [],
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = queryDef.wiql;
    }

    return resolution;
  }

  // ─── LinkQuery source ────────────────────────────────────────────────────────

  private async resolveLinkQuery(
    project: string | undefined,
    source: import('../domain/reviewScope.js').LinkQuerySource,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!project) {
      throw projectRequired('linkQuery');
    }

    const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields);
    const { wiql, warnings } = compiler.compileLinkQuery({
      project,
      sourceFilter: source.sourceFilter,
      targetFilter: source.targetFilter,
      linkTypes: source.linkTypes,
      mode: source.mode,
      orderBy: source.orderBy,
      asOf: source.asOf,
    });

    this.logger.debug({ project, sourceType: 'linkQuery', mode: source.mode }, 'Resolving linkQuery scope');

    const result = await this.wiqlClient.execute({ project, wiql, auth });

    const resolution: ScopeResolution = {
      project,
      sourceType: 'linkQuery',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings,
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
  }

  // ─── LinkedItems source ──────────────────────────────────────────────────────

  private async resolveLinkedItems(
    project: string | undefined,
    rootId: number,
    relationTypes: string[] | undefined,
    depth: number | undefined,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!this.workItemService) {
      throw new AdoScopeError(
        'linkedItems source requires WorkItemService to be injected into ReviewScopeResolver.',
        'CONFIGURATION_ERROR'
      );
    }

    const maxDepth = Math.min(depth ?? 1, MAX_DEPTH);
    const warnings: string[] = [];

    const visited = new Set<number>();
    visited.add(rootId);
    let frontier = [rootId];

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      this.logger.debug({ depth: d, frontierSize: frontier.length, rootId }, 'BFS level');

      const items = await this.workItemService.fetchWithRelations(frontier, auth);

      // Collect neighbors without adding to visited yet — so we can apply breadth cap before committing
      const nextFrontier: number[] = [];
      const nextSeen = new Set<number>();

      for (const item of items) {
        for (const rel of item.relations ?? []) {
          if (!isWorkItemRel(rel.rel)) continue;
          if (relationTypes && !relationTypes.includes(rel.rel)) continue;

          const neighborId = extractIdFromUrl(rel.url);
          if (neighborId !== null && !visited.has(neighborId) && !nextSeen.has(neighborId)) {
            nextSeen.add(neighborId);
            nextFrontier.push(neighborId);
          }
        }
      }

      const capped = nextFrontier.length > MAX_BREADTH_PER_LEVEL;
      if (capped) {
        warnings.push(
          `BFS level ${d + 1}: found ${nextFrontier.length} linked items, capped to ${MAX_BREADTH_PER_LEVEL}.`
        );
      }

      frontier = capped ? nextFrontier.slice(0, MAX_BREADTH_PER_LEVEL) : nextFrontier;
      for (const id of frontier) visited.add(id);
    }

    const ids = Array.from(visited);

    return {
      project,
      sourceType: 'linkedItems',
      ids,
      totalMatched: ids.length,
      warnings,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private noAuth(): AuthContext {
    return { mode: this.config.adoAuthMode };
  }
}

// ─── Error factories ─────────────────────────────────────────────────────────

export class AdoScopeError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AdoScopeError';
  }
}

function projectRequired(sourceType: string): AdoScopeError {
  return new AdoScopeError(
    `A project name is required for source type "${sourceType}". ` +
    `Provide it via the "project" field in the scope.`,
    'PROJECT_REQUIRED'
  );
}

function extractIdFromUrl(url: string): number | null {
  const match = /\/workItems\/(\d+)(?:[/?]|$)/i.exec(url);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}
