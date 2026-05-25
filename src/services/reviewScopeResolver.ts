import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { AuthContext } from '../auth/authContext.js';
import type { IWiqlClient } from '../ado/wiqlClient.js';
import type { IQueriesClient } from '../ado/queriesClient.js';
import type { ReviewScope, ScopeResolution } from '../domain/reviewScope.js';
import type { FieldFilter, FilterNode, OrderBy } from '../domain/fieldFilter.js';
import type { WorkItemService } from './workItemService.js';
import { createDefaultCompiler } from '../domain/genericWiqlCompiler.js';

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

    if (!source) {
      throw new AdoScopeError('ReviewScope.source is required for resolve()', 'MISSING_SOURCE');
    }

    switch (source.type) {
      case 'wiql':
        return this.resolveWiql(scope.project, source.wiql, auth);

      case 'ids':
        return this.resolveIdsViaWiql(scope.project, source.ids, auth);

      case 'fieldFilters':
        return this.resolveFieldFilters(scope.project, source.filters, source.filterTree, source.orderBy, source.asOf, auth);

      case 'linkQuery':
        return this.resolveLinkQuery(scope.project, source, auth);

      case 'linkedItems':
        return this.resolveLinkedItems(scope.project, source.rootIds, source.relationTypes, source.scopeFilter, source.depth, auth);

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

    const warnings: string[] = [];
    if (result.wiqlMaybeTruncated) {
      warnings.push('WIQL result may be truncated: ADO server returned exactly 20000 ids (hard ceiling). Scope may contain more items.');
    }

    const resolution: ScopeResolution = {
      project,
      sourceType: 'wiql',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings,
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
  }

  // ─── IDs source (WIQL-backed) ────────────────────────────────────────────────

  private async resolveIdsViaWiql(
    project: string | undefined,
    ids: number[],
    auth: AuthContext
  ): Promise<ScopeResolution> {
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

    if (!project) {
      // No project — return deduped IDs directly; ADO validation not possible without project context.
      warnings.push('No project provided for ids source — IDs returned without ADO validation.');
      return {
        sourceType: 'ids',
        ids: deduped,
        totalMatched: deduped.length,
        warnings,
      };
    }

    // Compile to WIQL so ADO validates and filters out cross-project / deleted IDs.
    const idList = deduped.join(', ');
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${idList})`;

    this.logger.debug({ project, sourceType: 'ids', count: deduped.length }, 'Resolving ids scope via WIQL');

    const result = await this.wiqlClient.execute({ project, wiql, auth });

    const dropped = deduped.filter((id) => !result.ids.includes(id));
    if (dropped.length > 0) {
      warnings.push(`ADO excluded ${dropped.length} ID(s) not found in project "${project}": ${dropped.join(', ')}.`);
    }

    const resolution: ScopeResolution = {
      project,
      sourceType: 'ids',
      ids: result.ids,
      totalMatched: result.ids.length,
      warnings,
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
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

    const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields, this.config.adoApiVersion);
    const { wiql, warnings } = compiler.compile({ project, filters, filterTree, orderBy, asOf });

    this.logger.debug(
      { project, sourceType: 'fieldFilters', usingFilterTree: !!filterTree, filterCount: filters?.length ?? 0 },
      'Resolving fieldFilters scope'
    );

    const result = await this.wiqlClient.execute({ project, wiql, auth });

    if (result.wiqlMaybeTruncated) {
      warnings.push('WIQL result may be truncated: ADO server returned exactly 20000 ids (hard ceiling). Scope may contain more items.');
    }

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

    const warnings: string[] = [];
    if (result.wiqlMaybeTruncated) {
      warnings.push('WIQL result may be truncated: ADO server returned exactly 20000 ids (hard ceiling). Scope may contain more items.');
    }

    const resolution: ScopeResolution = {
      project,
      sourceType: 'savedQuery',
      ids: result.ids,
      totalMatched: result.totalMatched,
      warnings,
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

    const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields, this.config.adoApiVersion);
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

    if (result.wiqlMaybeTruncated) {
      warnings.push('WIQL result may be truncated: ADO server returned exactly 20000 ids (hard ceiling). Scope may contain more items.');
    }

    const side = source.resultSide ?? 'source';
    const ids =
      side === 'source' ? result.sourceIds
      : side === 'target' ? result.targetIds
      : result.ids;

    const resolution: ScopeResolution = {
      project,
      sourceType: 'linkQuery',
      ids,
      totalMatched: ids.length,
      warnings,
    };

    if (this.config.adoEnableDebugOutput) {
      resolution.debugWiql = wiql;
    }

    return resolution;
  }

  // ─── LinkedItems source (per-hop WIQL) ──────────────────────────────────────

  private async resolveLinkedItems(
    project: string | undefined,
    rootIds: number[],
    relationTypes: string[],
    scopeFilter: FilterNode,
    depth: number | undefined,
    auth: AuthContext
  ): Promise<ScopeResolution> {
    if (!project) {
      throw projectRequired('linkedItems');
    }

    const maxDepth = Math.min(depth ?? 1, MAX_DEPTH);
    const warnings: string[] = [];
    const compiler = createDefaultCompiler(this.config.adoAllowUnknownFields, this.config.adoApiVersion);

    // Pre-validate rootIds: only those that satisfy scopeFilter enter the BFS.
    const { wiql: rootValidationWiql } = compiler.compile({
      project,
      filterTree: {
        kind: 'and',
        nodes: [
          { kind: 'condition', field: 'System.Id', operator: 'IN', value: rootIds },
          scopeFilter,
        ],
      },
    });
    const { ids: validRootIds } = await this.wiqlClient.execute({ project, wiql: rootValidationWiql, auth });
    const droppedRoots = rootIds.filter((id) => !validRootIds.includes(id));
    if (droppedRoots.length > 0) {
      warnings.push(`rootIds excluded by scopeFilter: ${droppedRoots.join(', ')}`);
    }

    const visited = new Set<number>(validRootIds);
    let frontier = [...validRootIds];
    const debugWiqls: string[] = [];

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      this.logger.debug({ project, depth: d, frontierSize: frontier.length }, 'linkedItems BFS hop');

      // Per-hop WIQL WorkItemLinks query: source=frontier, target=scopeFilter, ADO enforces scope.
      const sourceFilter: FilterNode = {
        kind: 'condition',
        field: 'System.Id',
        operator: 'IN',
        value: frontier,
      };

      const { wiql } = compiler.compileLinkQuery({
        project,
        sourceFilter,
        targetFilter: scopeFilter,
        linkTypes: relationTypes,
        mode: 'MustContain',
      });

      if (this.config.adoEnableDebugOutput) {
        debugWiqls.push(wiql);
      }

      const result = await this.wiqlClient.execute({ project, wiql, auth });

      const novel: number[] = [];
      const nextSeen = new Set<number>();
      for (const id of result.targetIds) {
        if (!visited.has(id) && !nextSeen.has(id)) {
          nextSeen.add(id);
          novel.push(id);
        }
      }

      const capped = novel.length > MAX_BREADTH_PER_LEVEL;
      if (capped) {
        warnings.push(
          `linkedItems BFS level ${d + 1}: found ${novel.length} new linked items, capped to ${MAX_BREADTH_PER_LEVEL}.`
        );
      }

      frontier = capped ? novel.slice(0, MAX_BREADTH_PER_LEVEL) : novel;
      for (const id of frontier) visited.add(id);
    }

    const ids = Array.from(visited);

    const resolution: ScopeResolution = {
      project,
      sourceType: 'linkedItems',
      ids,
      totalMatched: ids.length,
      warnings,
    };

    if (this.config.adoEnableDebugOutput && debugWiqls.length > 0) {
      resolution.debugWiql = debugWiqls.join('\n---\n');
    }

    return resolution;
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

