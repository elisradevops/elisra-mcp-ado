import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { ReviewScope } from '../../domain/reviewScope.js';
import { groupByFields, COMPACT_FIELDS } from '../../services/workItemService.js';
import { OperatorSchema, FilterValueSchema, FilterNodeSchema } from '../../domain/fieldFilter.js';
import { ANTI_HALLUCINATION_BANNER } from '../../domain/responseModes.js';
import { encodeCursor, decodeCursor, computeSourceHash } from '../../services/scopeSnapshotCache.js';
import { extractMetadataRefs } from '../../services/metadataValidator.js';

export const FieldFilterSchema = z.object({
  field: z.string().describe('Field reference name (e.g. System.State, Custom.CustomerID)'),
  operator: OperatorSchema,
  value: FilterValueSchema.optional().describe(
    'Scalar, array, or { fieldRef: "OtherField" } for field-to-field comparison. ' +
    'Omit for IS EMPTY / IS NOT EMPTY. Use array only with IN / NOT IN.'
  ),
});

const OrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['ASC', 'DESC']),
});

const SourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wiql'),
    wiql: z.string().describe('Raw WIQL query string'),
  }),
  z.object({
    type: z.literal('ids'),
    ids: z.array(z.number().int().positive()).min(1).describe('Work item IDs'),
  }),
  z.object({
    type: z.literal('fieldFilters'),
    filters: z.array(FieldFilterSchema).min(1).optional().describe(
      'Field filter conditions (ANDed together). Ignored when filterTree is provided.'
    ),
    filterTree: FilterNodeSchema.optional().describe(
      'Structured filter tree supporting AND/OR/NOT grouping. Wins over filters when both supplied.'
    ),
    orderBy: z.array(OrderBySchema).optional(),
    asOf: z.string().optional().describe('ASOF clause — ISO date (2025-01-01) or WIQL macro (@Today - 7d).'),
  }),
  z.object({
    type: z.literal('linkQuery'),
    sourceFilter: FilterNodeSchema.optional().describe('Filter conditions applied to source work items.'),
    targetFilter: FilterNodeSchema.optional().describe('Filter conditions applied to target work items.'),
    linkTypes: z.array(z.string()).optional().describe(
      'Link type reference names to filter on. Omit for all link types. ' +
      'Common types: System.LinkTypes.Hierarchy-Forward (parent→child), System.LinkTypes.Hierarchy-Reverse (child→parent), ' +
      'System.LinkTypes.Related, System.LinkTypes.Affects-Forward, System.LinkTypes.Affects-Reverse, ' +
      'Microsoft.VSTS.Common.TestedBy-Forward, Microsoft.VSTS.Common.TestedBy-Reverse, ' +
      'Elisra.CoveredBy-Forward (system req covers customer req), Elisra.CoveredBy-Reverse (customer req covered by system req). ' +
      'Customer work item ID is stored in field Custom.CustomerID (display name: "Customer ID").'
    ),
    mode: z.enum(['MustContain', 'MayContain', 'DoesNotContain', 'Recursive']).describe(
      'Link traversal mode. Recursive performs recursive traversal; cannot be combined with orderBy or asOf.'
    ),
    resultSide: z.enum(['source', 'target', 'both']).optional().default('source').describe(
      'Which side of the WIQL link relation to return as the result set. ' +
      'Default "source" — e.g. for a query with sourceFilter=Requirement and targetFilter=Test Case, ' +
      'returns the Requirements. Use "target" to return the Test Cases; ' +
      '"both" returns the full merged union (legacy behaviour, includes all linked work items).'
    ),
    orderBy: z.array(OrderBySchema).optional(),
    asOf: z.string().optional().describe('ASOF clause. Not allowed with mode=Recursive.'),
  }),
  z.object({
    type: z.literal('linkedItems'),
    rootIds: z.array(z.number().int().positive()).min(1).max(200).describe('Root work item IDs to traverse from'),
    relationTypes: z.array(z.string()).min(1).describe(
      'Required relation type whitelist (e.g. Elisra.CoveredBy-Forward). Restricts traversal to these types only. ' +
      'Common types: System.LinkTypes.Hierarchy-Forward, System.LinkTypes.Hierarchy-Reverse, ' +
      'System.LinkTypes.Related, Elisra.CoveredBy-Forward, Elisra.CoveredBy-Reverse.'
    ),
    scopeFilter: FilterNodeSchema.describe(
      'Required scope filter applied per hop via ADO WIQL WorkItemLinks query. ' +
      'Constrains which linked targets enter the result (e.g. System.AreaPath UNDER "ProjectX\\\\System Requirement"). ' +
      'Prevents out-of-scope items from entering the result set.'
    ),
    depth: z.number().int().min(1).max(3).optional().default(1).describe(
      'BFS depth. 1 = direct links only. Max 3.'
    ),
  }),
  z.object({
    type: z.literal('savedQuery'),
    queryPathOrId: z.string().describe('Saved query GUID or path (e.g. "Shared Queries/My Folder/My Query"). Backslash separators are normalized.'),
  }),
]);

const ValidatedSourceSchema = SourceSchema.superRefine((v, ctx) => {
  if (v.type === 'fieldFilters' && !v.filters?.length && !v.filterTree) {
    ctx.addIssue({ code: 'custom', message: 'fieldFilters source requires either filters or filterTree.' });
  }
});

export function registerScopeTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, wiqlClient, workItemService, reviewScopeResolver, scopeSnapshotCache, metadataValidator } = deps;

  // ── ado_resolve_review_scope ────────────────────────────────────────────────

  server.tool(
    'ado_resolve_review_scope',
    'Resolve a review scope (WIQL, IDs, field filters, or linked traversal) to a list of matching work item IDs. ' +
    'Always call this BEFORE calling any review tool to confirm scope and check totalMatched. ' +
    'Default responseMode is "overview" (counts + incomplete preview IDs only — do NOT use preview IDs for analysis). ' +
    'Use responseMode="ids" to retrieve the full ID list one page at a time via cursor pagination. ' +
    'Pagination: first call passes {pat, project, source, responseMode="ids", pageSize?}. ' +
    'Follow-up calls pass ONLY {pat, project, cursor} — do NOT re-send source. ' +
    'Repeat until pageInfo.isComplete=true. Never reason about IDs you have not yet received. ' +
    'Source types: wiql (raw WIQL flat query), ids (explicit ID list — validated via WIQL), ' +
    'fieldFilters (structured filters compiled to WIQL), ' +
    'linkQuery (WIQL WorkItemLinks single-hop, preferred for traversal), ' +
    'linkedItems (bounded BFS — REQUIRED fields: rootIds, relationTypes, scopeFilter; ' +
    'each hop is a WIQL WorkItemLinks query; scopeFilter prevents out-of-scope items), ' +
    'savedQuery (saved query id/path). ' +
    'Validation: all referenced fields, work item types, and link types are validated against ADO metadata before any WIQL runs.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name. Required for wiql and fieldFilters sources.'),
      source: ValidatedSourceSchema.optional(),
      responseMode: z.enum(['overview', 'ids']).optional().default('overview'),
      cursor: z.string().optional().describe(
        'Pagination cursor from a previous call\'s pageInfo.nextCursor. Only used in responseMode="ids". Omit for first page.'
      ),
      pageSize: z.number().int().positive().max(200).optional().describe(
        `IDs per page in "ids" mode. Default ${config.adoPageSizeDefault}, max ${config.adoPageSizeMax}.`
      ),
    },
    async ({ pat, project, source, responseMode, cursor, pageSize }) => {
      if (!cursor && !source) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MISSING_SOURCE', message: 'source is required for the first call. Follow-up calls pass only {cursor, pat, project}.' }) }],
          isError: true,
        };
      }
      const auth = resolveAuthContext(config, pat);

      if (source && !cursor) {
        const metaRefs = extractMetadataRefs(source);
        metaRefs.project = project;
        if (metaRefs.fields.length > 0 || metaRefs.workItemTypes.length > 0 || metaRefs.linkTypes.length > 0) {
          const metaResult = await metadataValidator.validate(metaRefs, auth);
          if (!metaResult.ok) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: metaResult.error, unknown: metaResult.unknown, hint: metaResult.hint }) }],
              isError: true,
            };
          }
        }
      }

      const scope: ReviewScope = { project, auth, source };

      try {
        if (responseMode === 'ids') {
          const effectivePageSize = Math.min(pageSize ?? config.adoPageSizeDefault, config.adoPageSizeMax);

          let allIds: number[];
          let totalMatched: number;
          let offset: number;
          let snapshotId: string;
          let warnings: string[];
          let resolvedProject: string | undefined;
          let resolvedSourceType: string;
          let debugWiql: string | undefined;

          if (!cursor) {
            const resolution = await reviewScopeResolver.resolve(scope);
            const sourceHash = source ? computeSourceHash(resolution.project, resolution.sourceType, source) : undefined;
            snapshotId = scopeSnapshotCache.put(resolution.ids, {
              project: resolution.project,
              sourceType: resolution.sourceType,
              sourceHash,
            });
            allIds = resolution.ids;
            totalMatched = resolution.totalMatched;
            offset = 0;
            warnings = resolution.warnings;
            resolvedProject = resolution.project;
            resolvedSourceType = resolution.sourceType;
            debugWiql = resolution.debugWiql;
          } else {
            const decoded = decodeCursor(cursor);
            if (!decoded) {
              logger.warn({
                cursorLength: cursor.length,
                cursorPrefix: cursor.slice(0, 8),
                cursorSuffix: cursor.slice(-4),
                hasWhitespace: /\s/.test(cursor),
                hasQuotes: cursor.includes('"') || cursor.includes("'"),
                looksBase64url: /^[A-Za-z0-9_-]+$/.test(cursor),
              }, 'CURSOR_INVALID — decodeCursor returned null');
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'CURSOR_INVALID', message: 'Cursor is malformed. Restart pagination by calling without cursor.' }) }],
                isError: true,
              };
            }
            const snapshot = scopeSnapshotCache.get(decoded.snapshotId);
            if (!snapshot) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'CURSOR_EXPIRED', message: 'Cursor has expired or been evicted. Restart pagination by calling without cursor.' }) }],
                isError: true,
              };
            }
            if (source && snapshot.meta.sourceHash) {
              const callerHash = computeSourceHash(snapshot.meta.project, snapshot.meta.sourceType, source);
              if (callerHash !== snapshot.meta.sourceHash) {
                return {
                  content: [{ type: 'text' as const, text: JSON.stringify({ error: 'CURSOR_SCOPE_MISMATCH', message: 'Cursor was issued for a different scope. Restart pagination without cursor for this source.' }) }],
                  isError: true,
                };
              }
            }
            allIds = snapshot.ids;
            totalMatched = snapshot.ids.length;
            offset = decoded.offset;
            snapshotId = decoded.snapshotId;
            warnings = [];
            resolvedProject = snapshot.meta.project;
            resolvedSourceType = snapshot.meta.sourceType;
            debugWiql = undefined;
          }

          const pageIds = allIds.slice(offset, offset + effectivePageSize);
          const nextOffset = offset + effectivePageSize;
          const nextCursor = nextOffset < allIds.length ? encodeCursor(snapshotId, nextOffset) : null;

          return {
            content: [{
              type: 'text' as const,
              text: safeJsonStringify({
                _instruction: ANTI_HALLUCINATION_BANNER,
                project: resolvedProject,
                sourceType: resolvedSourceType,
                totalMatched,
                responseMode: 'ids',
                pageInfo: {
                  totalMatched,
                  offset,
                  pageSize: effectivePageSize,
                  returnedCount: pageIds.length,
                  nextCursor,
                  isComplete: nextCursor === null,
                },
                ids: pageIds,
                warnings,
                ...(debugWiql !== undefined ? { debugWiql } : {}),
              }, 2),
            }],
          };
        }

        // overview mode
        const resolution = await reviewScopeResolver.resolve(scope);
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              _instruction: ANTI_HALLUCINATION_BANNER,
              project: resolution.project,
              sourceType: resolution.sourceType,
              totalMatched: resolution.totalMatched,
              warnings: resolution.warnings,
              incompletePreviewIds_doNotUseForAnalysis: resolution.ids.slice(0, 10),
              ...(resolution.debugWiql !== undefined ? { debugWiql: resolution.debugWiql } : {}),
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_resolve_review_scope failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_query_work_item_ids ────────────────────────────────────────────────

  server.tool(
    'ado_query_work_item_ids',
    'Execute a raw WIQL query and return only the matching work item IDs. ' +
    'Use this when you have a known WIQL string. For field-filter-based queries, prefer ado_resolve_review_scope with source.type="fieldFilters".',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().describe('Project name. Required for WIQL execution.'),
      wiql: z.string().describe('WIQL query string. Must SELECT [System.Id] FROM WorkItems.'),
      top: z.number().int().positive().optional().describe('Cap on results returned by ADO (default: no cap).'),
    },
    async ({ pat, project, wiql, top }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        const result = await wiqlClient.execute({ project, wiql, auth, top });
        logger.info({ project, totalMatched: result.totalMatched }, 'ado_query_work_item_ids succeeded');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project,
              ids: result.ids,
              totalMatched: result.totalMatched,
              queryType: result.queryType,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_query_work_item_ids failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_get_review_scope_overview ─────────────────────────────────────────

  server.tool(
    'ado_get_review_scope_overview',
    'Resolve a scope to IDs, fetch compact work item data, and return grouped counts. ' +
    'Useful for understanding distribution (by state, type, area) before running a full review. ' +
    'Default groupBy fields: System.WorkItemType and System.State.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      groupBy: z.array(z.string()).optional().default(['System.WorkItemType', 'System.State']).describe(
        'Fields to group by. Must be in the compact field set or fetched fields.'
      ),
      maxItems: z.number().int().positive().optional().default(500).describe(
        'Cap on work items to fetch for grouping.'
      ),
    },
    async ({ pat, project, source, groupBy, maxItems }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);

        const ids = resolution.ids.slice(0, maxItems);
        const fetchFields = [...new Set([...COMPACT_FIELDS, ...groupBy])];
        const items = await workItemService.fetchMany(ids, auth, { fields: fetchFields }, resolution.project);

        const groups = groupByFields(items, groupBy);

        logger.info({ totalMatched: resolution.totalMatched, fetched: items.length }, 'ado_get_review_scope_overview succeeded');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project: resolution.project,
              sourceType: resolution.sourceType,
              totalMatched: resolution.totalMatched,
              fetched: items.length,
              truncated: resolution.ids.length > maxItems,
              groups,
              warnings: resolution.warnings,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_get_review_scope_overview failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );
}
