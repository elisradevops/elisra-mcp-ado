import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { ReviewScope } from '../../domain/reviewScope.js';
import { groupByFields, COMPACT_FIELDS } from '../../services/workItemService.js';
import { takeSampleIds } from '../../domain/responseModes.js';
import { OperatorSchema, FilterValueSchema, FilterNodeSchema } from '../../domain/fieldFilter.js';

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
    rootId: z.number().int().positive().describe('Root work item ID to traverse from'),
    relationTypes: z.array(z.string()).optional().describe(
      'Relation type filter (e.g. System.LinkTypes.Hierarchy-Forward). Omit for all WI relation types.'
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

export function registerScopeTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, wiqlClient, workItemService, reviewScopeResolver } = deps;

  // ── ado_resolve_review_scope ────────────────────────────────────────────────

  server.tool(
    'ado_resolve_review_scope',
    'Resolve a review scope (WIQL, IDs, field filters, or linked traversal) to a list of matching work item IDs. ' +
    'Use this before calling review or context tools to confirm the scope is what you expect. ' +
    'Default response mode is "overview" (counts only). Use responseMode="ids" for the full ID list.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name. Required for wiql and fieldFilters sources.'),
      source: SourceSchema,
      responseMode: z.enum(['overview', 'ids']).optional().default('overview'),
      maxIds: z.number().int().positive().optional().default(500).describe('Cap on returned IDs in ids mode.'),
    },
    async ({ pat, project, source, responseMode, maxIds }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);

        const base = {
          project: resolution.project,
          sourceType: resolution.sourceType,
          totalMatched: resolution.totalMatched,
          warnings: resolution.warnings,
          ...(resolution.debugWiql !== undefined ? { debugWiql: resolution.debugWiql } : {}),
        };

        if (responseMode === 'ids') {
          const ids = maxIds ? resolution.ids.slice(0, maxIds) : resolution.ids;
          return { content: [{ type: 'text' as const, text: safeJsonStringify({ ...base, ids }, 2) }] };
        }

        // overview: include sample IDs for drill-down
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              ...base,
              sampleIds: takeSampleIds(resolution.ids),
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
      source: SourceSchema,
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
        const items = await workItemService.fetchMany(ids, auth, { fields: fetchFields });

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
