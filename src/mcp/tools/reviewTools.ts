import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import type { FieldDiscoveryService } from '../../services/fieldDiscoveryService.js';
import type { AuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { ReviewScope } from '../../domain/reviewScope.js';
import { REVIEW_FIELDS } from '../../services/requirementReviewService.js';
import type { AdoWorkItem } from '../../types/ado.js';
import { buildPageInfo, ANTI_HALLUCINATION_BANNER } from '../../domain/responseModes.js';
import { encodeCursor, decodeCursor } from '../../services/scopeSnapshotCache.js';
import type { ScopeSnapshotCache } from '../../services/scopeSnapshotCache.js';
import type { ReviewScopeResolver } from '../../services/reviewScopeResolver.js';
import { FieldFilterSchema } from './scopeTools.js';
import { FilterNodeSchema } from '../../domain/fieldFilter.js';
import { toCompactRecord } from '../../services/workItemService.js';
import { htmlToText } from '../../utils/htmlToText.js';
import type { Logger } from '../../logging/logger.js';

const CONTEXT_ONLY_NOTICE =
  'This tool returns Azure DevOps context only. ' +
  'It does not perform review, scoring, gap analysis, consistency analysis, or quality classification. ' +
  'The LLM must apply the Open WebUI system prompt, Knowledge / RAG, and user prompt rules to produce findings. ' +
  'The assistant generates conclusions in the final response — it does not receive conclusions from this tool.';

const SourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wiql'), wiql: z.string() }),
  z.object({ type: z.literal('ids'), ids: z.array(z.number().int().positive()).min(1) }),
  z.object({
    type: z.literal('fieldFilters'),
    filters: z.array(FieldFilterSchema).min(1).optional(),
    filterTree: FilterNodeSchema.optional(),
    orderBy: z.array(z.object({ field: z.string(), direction: z.enum(['ASC', 'DESC']) })).optional(),
    asOf: z.string().optional(),
  }),
  z.object({
    type: z.literal('linkQuery'),
    sourceFilter: FilterNodeSchema.optional(),
    targetFilter: FilterNodeSchema.optional(),
    linkTypes: z.array(z.string()).optional().describe(
      'Link type reference names. Common: System.LinkTypes.Hierarchy-Forward/Reverse, System.LinkTypes.Related, ' +
      'System.LinkTypes.Affects-Forward/Reverse, Microsoft.VSTS.Common.TestedBy-Forward/Reverse, ' +
      'Elisra.CoveredBy-Forward (system covers customer req), Elisra.CoveredBy-Reverse (customer req covered by system). ' +
      'Customer work item ID is stored in field Custom.CustomerID (display name: "Customer ID").'
    ),
    mode: z.enum(['MustContain', 'MayContain', 'DoesNotContain', 'Recursive']),
    resultSide: z.enum(['source', 'target', 'both']).optional().default('source').describe(
      'Which side of the WIQL link relation to return. Default "source". ' +
      'E.g. sourceFilter=Requirement + targetFilter=Test Case with "source" → returns Requirements; ' +
      '"target" → returns Test Cases; "both" → full merged union.'
    ),
    orderBy: z.array(z.object({ field: z.string(), direction: z.enum(['ASC', 'DESC']) })).optional(),
    asOf: z.string().optional(),
  }),
  z.object({
    type: z.literal('linkedItems'),
    rootId: z.number().int().positive(),
    relationTypes: z.array(z.string()).optional(),
    depth: z.number().int().min(1).max(3).optional().default(1),
  }),
  z.object({ type: z.literal('savedQuery'), queryPathOrId: z.string() }),
]);

const ValidatedSourceSchema = SourceSchema.superRefine((v, ctx) => {
  if (v.type === 'fieldFilters' && !v.filters?.length && !v.filterTree) {
    ctx.addIssue({ code: 'custom', message: 'fieldFilters source requires either filters or filterTree.' });
  }
});

interface ResolvedReviewFields {
  fields: string[];
  dropped: string[];
  discoveryError?: string;
}

async function resolveAvailableReviewFields(
  fieldDiscoveryService: FieldDiscoveryService,
  auth: AuthContext,
  project: string | undefined,
  extras: readonly string[],
  logger: ToolDeps['logger'],
): Promise<ResolvedReviewFields> {
  const requested = [...REVIEW_FIELDS, ...extras];
  const deduped = [...new Set(requested.map((s) => s.trim()).filter(Boolean))];
  try {
    const catalog = await fieldDiscoveryService.discover({ auth, project });
    const dropped: string[] = [];
    const kept: string[] = [];
    for (const ref of deduped) {
      if (ref.startsWith('System.') || catalog.has(ref)) {
        kept.push(ref);
      } else {
        dropped.push(ref);
      }
    }
    return { fields: kept, dropped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Field discovery unavailable; falling back to full requested set');
    return { fields: deduped, dropped: [], discoveryError: message };
  }
}

// ─── Context record helpers ────────────────────────────────────────────────────

function extractRelationTargetId(url: string): number | null {
  const m = /\/workItems\/(\d+)(?:[/?]|$)/i.exec(url);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

const DESC_MAX_CHARS = 2_000;
const AC_MAX_CHARS = 500;

function toContextItem(item: AdoWorkItem): Record<string, unknown> {
  const rec = toCompactRecord(item) as Record<string, unknown>;

  const rawDesc = item.fields['System.Description'];
  if (rawDesc) {
    const plain = htmlToText(String(rawDesc));
    rec['descriptionTruncated'] = plain.length > DESC_MAX_CHARS;
    rec['description'] = plain.length > DESC_MAX_CHARS
      ? plain.slice(0, DESC_MAX_CHARS) + '… [truncated]'
      : plain;
  }

  const rawAC = item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'];
  if (rawAC) {
    const plain = htmlToText(String(rawAC));
    rec['acceptanceCriteriaTruncated'] = plain.length > AC_MAX_CHARS;
    rec['acceptanceCriteria'] = plain.length > AC_MAX_CHARS ? plain.slice(0, AC_MAX_CHARS) + '… [truncated]' : plain;
  }

  const vm = item.fields['Microsoft.VSTS.Common.VerificationMethod'];
  if (vm != null && vm !== '') rec['verificationMethod'] = vm;

  if (item.relations) {
    rec['relations'] = item.relations
      .map((r) => ({ rel: r.rel, targetId: extractRelationTargetId(r.url) }))
      .filter((r) => r.targetId !== null);
  }

  return rec;
}

// ─── Structural grouping helpers (no pair analysis — context only) ─────────────

function structuralGroupByParent(items: AdoWorkItem[]): Array<{ groupKey: string; groupBy: string; memberIds: number[] }> {
  const map = new Map<string, number[]>();
  for (const item of items) {
    const parentRel = (item.relations ?? []).find((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (!parentRel) continue;
    const m = /\/workItems\/(\d+)/i.exec(parentRel.url);
    if (!m) continue;
    const key = `parent:${m[1]}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item.id);
  }
  return Array.from(map.entries())
    .filter(([, ids]) => ids.length >= 2)
    .map(([groupKey, memberIds]) => ({ groupKey, groupBy: 'parent', memberIds }));
}

function structuralGroupByField(items: AdoWorkItem[], field: string): Array<{ groupKey: string; groupBy: string; memberIds: number[] }> {
  const map = new Map<string, number[]>();
  for (const item of items) {
    const raw = item.fields[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const key = `${field}:${String(raw)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item.id);
  }
  return Array.from(map.entries())
    .filter(([, ids]) => ids.length >= 2)
    .map(([groupKey, memberIds]) => ({ groupKey, groupBy: field, memberIds }));
}

function structuralGroupByTitleTokens(items: AdoWorkItem[]): Array<{ groupKey: string; groupBy: string; memberIds: number[] }> {
  const STOP = new Set(['the', 'and', 'for', 'shall', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'its']);
  const tokenize = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const map = new Map<string, number[]>();
  for (const item of items) {
    const title = String(item.fields['System.Title'] ?? '');
    const key = tokenize(title).slice(0, 4).sort().join('|');
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item.id);
  }
  return Array.from(map.entries())
    .filter(([, ids]) => ids.length >= 2)
    .map(([groupKey, memberIds]) => ({ groupKey, groupBy: 'title-tokens', memberIds }));
}

// ─── Shared pagination helpers ─────────────────────────────────────────────────

interface PaginationState {
  allIds: number[];
  offset: number;
  totalMatched: number;
  snapshotId: string;
  resolvedProject: string | undefined;
  resolvedSourceType: string;
  warnings: string[];
}

type McpErrorResponse = {
  content: [{ type: 'text'; text: string }];
  isError: true;
};

async function resolvePaginationState(
  cursor: string | undefined,
  scope: ReviewScope,
  effectivePageSize: number, // schema cap (200) is documentation; runtime clamp is the actual enforcement
  reviewScopeResolver: ReviewScopeResolver,
  scopeSnapshotCache: ScopeSnapshotCache,
  logger: Logger,
): Promise<PaginationState | McpErrorResponse> {
  if (!cursor) {
    const resolution = await reviewScopeResolver.resolve(scope);
    const snapshotId = scopeSnapshotCache.put(resolution.ids, { project: resolution.project, sourceType: resolution.sourceType });
    return {
      allIds: resolution.ids,
      offset: 0,
      totalMatched: resolution.totalMatched,
      snapshotId,
      resolvedProject: resolution.project,
      resolvedSourceType: resolution.sourceType,
      warnings: resolution.warnings,
    };
  }
  const decoded = decodeCursor(cursor);
  if (decoded === null) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'CURSOR_INVALID', message: 'Cursor is malformed. Restart pagination by calling without cursor.' }) }], isError: true };
  }
  const snapshot = scopeSnapshotCache.get(decoded.snapshotId);
  if (snapshot === null) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'CURSOR_EXPIRED', message: 'Cursor has expired or been evicted. Restart pagination by calling without cursor.' }) }], isError: true };
  }
  return {
    allIds: snapshot.ids,
    offset: decoded.offset,
    totalMatched: snapshot.ids.length,
    snapshotId: decoded.snapshotId,
    resolvedProject: snapshot.meta.project,
    resolvedSourceType: snapshot.meta.sourceType,
    warnings: [],
  };
}

function extractHttpErrorMeta(err: unknown): { url: unknown; status: unknown; method: unknown } {
  const config = (err as Record<string, unknown>)?.['config'];
  if (typeof config !== 'object' || config === null) return { url: undefined, status: undefined, method: undefined };
  const axiosErr = err as { response?: { status?: unknown }; config: { url?: unknown; method?: unknown } };
  return {
    url: axiosErr.config?.url,
    status: axiosErr.response?.status,
    method: axiosErr.config?.method,
  };
}

export function registerReviewTools(server: McpServer, deps: ToolDeps): void {
  const {
    config, logger, reviewScopeResolver, workItemService, fieldDiscoveryService, scopeSnapshotCache,
  } = deps;

  // ── ado_review_work_items ──────────────────────────────────────────────────

  server.tool(
    'ado_review_work_items',
    CONTEXT_ONLY_NOTICE + ' ' +
    'Resolves a scope, fetches ONE PAGE of work items with their fields, and returns a compact evidence packet. ' +
    'To analyze the full scope, iterate: call the tool, read items[], if pageInfo.isComplete=false call again with cursor=pageInfo.nextCursor, accumulate items, repeat until isComplete=true. Never reason about items you have not yet received. ' +
    'Use responseMode="overview" to get counts and ID list only without fetching item bodies. ' +
    'Set includeRelations=true to fetch traceability links — omit it (default false) if you get 404 errors on batch fetch.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      responseMode: z.enum(['overview', 'page']).optional().default('overview'),
      cursor: z.string().optional().describe(
        'Pagination cursor from a previous call\'s pageInfo.nextCursor. Omit for first page.'
      ),
      pageSize: z.number().int().positive().max(200).optional()
        .describe(`Items per page. Default ${config.adoPageSizeDefault}, max ${config.adoPageSizeMax}.`),
      includeRelations: z.boolean().optional().default(false).describe(
        'Set true to fetch relation links (traceability). Default false — avoids 404 errors on on-prem ADO Server caused by $expand=relations on batch fetch.'
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in context fields. Refs not present in the collection are dropped and reported in fetchMetadata.warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links on relation rel names. ' +
        'Default: ADO_TRACEABILITY_LINK_TOKENS env (Affects, CoveredBy, TestedBy). ' +
        'Returned in fetchMetadata so the LLM knows which relation types to treat as traceability evidence.'
      ),
    },
    async ({ pat, project, source, responseMode, cursor, pageSize, includeRelations, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;

        // ── overview mode ────────────────────────────────────────────────────
        if (responseMode === 'overview') {
          const resolution = await reviewScopeResolver.resolve(scope);
          logger.info({ totalMatched: resolution.totalMatched }, 'ado_review_work_items overview');
          return {
            content: [{
              type: 'text' as const,
              text: safeJsonStringify({
                _instruction: ANTI_HALLUCINATION_BANNER,
                scope: {
                  project: resolution.project,
                  sourceType: resolution.sourceType,
                  totalMatched: resolution.totalMatched,
                },
                responseMode: 'overview',
                incompletePreviewIds_doNotUseForAnalysis: resolution.ids.slice(0, 20),
                fetchMetadata: {
                  project: resolution.project,
                  apiVersion: config.adoApiVersion,
                  fetchedAt: new Date().toISOString(),
                  toolName: 'ado_review_work_items',
                  itemCount: 0,
                  traceabilityLinkTokens: traceTokens,
                  warnings: resolution.warnings,
                },
                truncation: {
                  wasTruncated: resolution.ids.length > 20,
                  limit: 20,
                  returnedCount: Math.min(resolution.ids.length, 20),
                  totalKnownCount: resolution.totalMatched,
                  reason: 'overview mode returns ID preview only — use responseMode="page" to fetch item bodies',
                },
                missingData: [
                  { type: 'item_bodies', reason: 'not_requested', details: 'Use responseMode="page" to fetch work item fields and descriptions.' },
                  { type: 'relations', reason: 'not_requested', details: 'Use responseMode="page" with includeRelations=true to fetch relation links.' },
                ],
              }, 2),
            }],
          };
        }

        // ── page mode ────────────────────────────────────────────────────────
        const effectivePageSize = Math.min(pageSize ?? config.adoPageSizeDefault, config.adoPageSizeMax);
        const paginationResult = await resolvePaginationState(cursor, scope, effectivePageSize, reviewScopeResolver, scopeSnapshotCache, logger);
        if ('isError' in paginationResult) return paginationResult;
        const { allIds, offset, totalMatched, snapshotId, resolvedProject, resolvedSourceType, warnings: scopeWarnings } = paginationResult;

        const pageIds = allIds.slice(offset, offset + effectivePageSize);
        const extras = [...config.adoReviewExtraFields, ...(extraFields ?? [])];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);

        const items = await workItemService.fetchMany(pageIds, auth, {
          fields: reviewFields,
          expand: includeRelations ? 'relations' : undefined,
        }, resolvedProject);

        const nextOffset = offset + effectivePageSize;
        const nextCursor = nextOffset < allIds.length
          ? encodeCursor(snapshotId, nextOffset)
          : null;

        const allWarnings: string[] = [
          ...scopeWarnings,
          ...(dropped.length ? [`Fields not found in collection and dropped: ${dropped.join(', ')}`] : []),
          ...(discoveryError ? [`Field discovery unavailable: ${discoveryError}`] : []),
        ];

        logger.info({ totalMatched, fetched: items.length, offset, effectivePageSize }, 'ado_review_work_items page');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              _instruction: ANTI_HALLUCINATION_BANNER,
              scope: {
                project: resolvedProject,
                sourceType: resolvedSourceType,
                totalMatched,
              },
              pageInfo: buildPageInfo(totalMatched, offset, effectivePageSize, items.length, nextCursor),
              responseMode: 'page',
              items: items.map(toContextItem),
              fetchMetadata: {
                project: resolvedProject,
                apiVersion: config.adoApiVersion,
                fetchedAt: new Date().toISOString(),
                toolName: 'ado_review_work_items',
                itemCount: items.length,
                traceabilityLinkTokens: traceTokens,
                warnings: allWarnings,
              },
              missingData: includeRelations ? [] : [
                { type: 'relations', reason: 'not_requested', details: 'Set includeRelations=true to fetch traceability relation links.' },
              ],
            }, 2),
          }],
        };
      } catch (err) {
        const { url, status, method } = extractHttpErrorMeta(err);
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, url, status, method: typeof method === 'string' ? method.toUpperCase() : method, responseMode, sourceType: source.type }, 'ado_review_work_items failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_review_requirements ───────────────────────────────────────────────

  server.tool(
    'ado_review_requirements',
    CONTEXT_ONLY_NOTICE + ' ' +
    'Resolves a scope, fetches ONE PAGE of requirement work items with their fields and relations, and returns a compact context packet. ' +
    'Tip: add a fieldFilters source with System.WorkItemType IN ["Requirement","Feature"] to scope to requirement types. ' +
    'To analyze the full scope, iterate: call the tool, read items[], if pageInfo.isComplete=false call again with cursor=pageInfo.nextCursor, accumulate items, repeat until isComplete=true. Never reason about items you have not yet received. ' +
    'Use responseMode="overview" to get counts and ID list only without fetching item bodies. ' +
    'The LLM applies its requirement review rules (from the system prompt, Knowledge/RAG, and/or user prompt) to the returned items.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      responseMode: z.enum(['overview', 'page']).optional().default('overview'),
      cursor: z.string().optional().describe(
        'Pagination cursor from a previous call\'s pageInfo.nextCursor. Omit for first page.'
      ),
      pageSize: z.number().int().positive().max(200).optional()
        .describe(`Items per page. Default ${config.adoPageSizeDefault}, max ${config.adoPageSizeMax}.`),
      includeRelations: z.boolean().optional().default(false).describe(
        'Set true to fetch relation links (traceability). Default false — avoids 404 errors on on-prem ADO Server caused by $expand=relations on batch fetch.'
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in context fields. Refs not present in the collection are dropped and reported in fetchMetadata.warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links on relation rel names. ' +
        'Default: ADO_TRACEABILITY_LINK_TOKENS env (Affects, CoveredBy, TestedBy). ' +
        'Returned in fetchMetadata so the LLM knows which relation types to treat as traceability evidence.'
      ),
    },
    async ({ pat, project, source, responseMode, cursor, pageSize, includeRelations, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source, preset: 'requirement_quality' };

      try {
        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;

        // ── overview mode ────────────────────────────────────────────────────
        if (responseMode === 'overview') {
          const resolution = await reviewScopeResolver.resolve(scope);
          logger.info({ totalMatched: resolution.totalMatched }, 'ado_review_requirements overview');
          return {
            content: [{
              type: 'text' as const,
              text: safeJsonStringify({
                _instruction: ANTI_HALLUCINATION_BANNER,
                scope: {
                  project: resolution.project,
                  sourceType: resolution.sourceType,
                  totalMatched: resolution.totalMatched,
                },
                responseMode: 'overview',
                incompletePreviewIds_doNotUseForAnalysis: resolution.ids.slice(0, 20),
                fetchMetadata: {
                  project: resolution.project,
                  apiVersion: config.adoApiVersion,
                  fetchedAt: new Date().toISOString(),
                  toolName: 'ado_review_requirements',
                  itemCount: 0,
                  traceabilityLinkTokens: traceTokens,
                  warnings: resolution.warnings,
                },
                truncation: {
                  wasTruncated: resolution.ids.length > 20,
                  limit: 20,
                  returnedCount: Math.min(resolution.ids.length, 20),
                  totalKnownCount: resolution.totalMatched,
                  reason: 'overview mode returns ID preview only — use responseMode="page" to fetch item bodies',
                },
                missingData: [
                  { type: 'item_bodies', reason: 'not_requested', details: 'Use responseMode="page" to fetch work item fields and descriptions.' },
                  { type: 'relations', reason: 'not_requested', details: 'Use responseMode="page" with includeRelations=true to fetch relation links.' },
                ],
              }, 2),
            }],
          };
        }

        // ── page mode ────────────────────────────────────────────────────────
        const effectivePageSize = Math.min(pageSize ?? config.adoPageSizeDefault, config.adoPageSizeMax);
        const paginationResult = await resolvePaginationState(cursor, scope, effectivePageSize, reviewScopeResolver, scopeSnapshotCache, logger);
        if ('isError' in paginationResult) return paginationResult;
        const { allIds, offset, totalMatched, snapshotId, resolvedProject, resolvedSourceType, warnings: scopeWarnings } = paginationResult;

        const pageIds = allIds.slice(offset, offset + effectivePageSize);
        const extras = [...config.adoReviewExtraFields, ...(extraFields ?? [])];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);

        const items = await workItemService.fetchMany(pageIds, auth, {
          fields: reviewFields,
          expand: includeRelations ? 'relations' : undefined,
        }, resolvedProject);

        const nextOffset = offset + effectivePageSize;
        const nextCursor = nextOffset < allIds.length
          ? encodeCursor(snapshotId, nextOffset)
          : null;

        const allWarnings: string[] = [
          ...scopeWarnings,
          ...(dropped.length ? [`Fields not found in collection and dropped: ${dropped.join(', ')}`] : []),
          ...(discoveryError ? [`Field discovery unavailable: ${discoveryError}`] : []),
        ];

        logger.info({ totalMatched, fetched: items.length, offset, effectivePageSize }, 'ado_review_requirements page');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              _instruction: ANTI_HALLUCINATION_BANNER,
              scope: {
                project: resolvedProject,
                sourceType: resolvedSourceType,
                totalMatched,
              },
              pageInfo: buildPageInfo(totalMatched, offset, effectivePageSize, items.length, nextCursor),
              responseMode: 'page',
              items: items.map(toContextItem),
              fetchMetadata: {
                project: resolvedProject,
                apiVersion: config.adoApiVersion,
                fetchedAt: new Date().toISOString(),
                toolName: 'ado_review_requirements',
                itemCount: items.length,
                traceabilityLinkTokens: traceTokens,
                warnings: allWarnings,
              },
              missingData: includeRelations ? [] : [
                { type: 'relations', reason: 'not_requested', details: 'Set includeRelations=true to fetch traceability relation links.' },
              ],
            }, 2),
          }],
        };
      } catch (err) {
        const { url, status, method } = extractHttpErrorMeta(err);
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, url, status, method: typeof method === 'string' ? method.toUpperCase() : method, responseMode, sourceType: source.type }, 'ado_review_requirements failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_find_requirement_completeness_gaps ────────────────────────────────

  server.tool(
    'ado_find_requirement_completeness_gaps',
    CONTEXT_ONLY_NOTICE + ' ' +
    'Fetches ONE PAGE of work items and, when contextMode=L3, groups them by groupField to build a peer-group ID map. ' +
    'Returns the raw items plus structural peer-group membership so the LLM can identify completeness patterns itself. ' +
    'To analyze the full scope, iterate: call the tool, read items[], if pageInfo.isComplete=false call again with cursor=pageInfo.nextCursor, accumulate items, repeat until isComplete=true. Never reason about items you have not yet received. ' +
    'The LLM must apply completeness rules (from the system prompt, Knowledge/RAG, and/or user prompt) to the returned context. ' +
    'L1: single-item field presence. L2: traceability links (requires relations). L3: peer-field comparison (requires groupField).',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      contextMode: z.enum(['L1', 'L2', 'L3']).optional().default('L2').describe(
        'Context depth. L1=single-item fields, L2=+relations/traceability, L3=+peer-group membership.'
      ),
      groupField: z.string().optional().describe(
        'Field to group items for L3 peer analysis (e.g. System.AreaPath, Custom.SubSystem). Required for L3.'
      ),
      cursor: z.string().optional().describe(
        'Pagination cursor from a previous call\'s pageInfo.nextCursor. Omit for first page.'
      ),
      pageSize: z.number().int().positive().max(200).optional()
        .describe(`Items per page. Default ${config.adoPageSizeDefault}, max ${config.adoPageSizeMax}.`),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in context fields. Refs not present in the collection are dropped and reported in fetchMetadata.warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links. Returned in fetchMetadata so the LLM knows which relation types to treat as traceability evidence.'
      ),
    },
    async ({ pat, project, source, contextMode, groupField, cursor, pageSize, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const effectivePageSize = Math.min(pageSize ?? config.adoPageSizeDefault, config.adoPageSizeMax);
        const needsRelations = contextMode === 'L2' || contextMode === 'L3';

        const paginationResult = await resolvePaginationState(cursor, scope, effectivePageSize, reviewScopeResolver, scopeSnapshotCache, logger);
        if ('isError' in paginationResult) return paginationResult;
        const { allIds, offset, totalMatched, snapshotId, resolvedProject, resolvedSourceType, warnings: scopeWarnings } = paginationResult;

        const pageIds = allIds.slice(offset, offset + effectivePageSize);

        const extras = [
          ...config.adoReviewExtraFields,
          ...(extraFields ?? []),
          ...(groupField ? [groupField] : []),
        ];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);

        const items = await workItemService.fetchMany(pageIds, auth, {
          fields: reviewFields,
          expand: needsRelations ? 'relations' : undefined,
        }, resolvedProject);

        // Build peer-group ID map for L3 — structural only, no gap analysis
        let peerGroupIds: Record<number, number[]> | undefined;
        if (contextMode === 'L3' && groupField) {
          const byFieldValue = new Map<string, number[]>();
          for (const item of items) {
            const v = item.fields[groupField];
            if (v === undefined || v === null || v === '') continue;
            const key = String(v);
            if (!byFieldValue.has(key)) byFieldValue.set(key, []);
            byFieldValue.get(key)!.push(item.id);
          }
          peerGroupIds = {};
          for (const group of byFieldValue.values()) {
            for (const itemId of group) {
              peerGroupIds[itemId] = group.filter((id) => id !== itemId);
            }
          }
        }

        const nextOffset = offset + effectivePageSize;
        const nextCursor = nextOffset < allIds.length
          ? encodeCursor(snapshotId, nextOffset)
          : null;

        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;
        const allWarnings: string[] = [
          ...scopeWarnings,
          ...(dropped.length ? [`Fields not found in collection and dropped: ${dropped.join(', ')}`] : []),
          ...(discoveryError ? [`Field discovery unavailable: ${discoveryError}`] : []),
          ...(contextMode === 'L3' && !groupField ? ['contextMode=L3 requires groupField — peer groups not built.'] : []),
        ];

        const missingData: Array<{ type: string; reason: string; details?: string }> = [];
        if (!needsRelations) {
          missingData.push({ type: 'relations', reason: 'not_requested', details: 'Use contextMode=L2 or L3 to fetch traceability relations.' });
        }
        if (contextMode === 'L3' && !groupField) {
          missingData.push({ type: 'peerGroupIds', reason: 'not_requested', details: 'Provide groupField to enable L3 peer-group context.' });
        }

        logger.info({ totalMatched, fetched: items.length, offset, effectivePageSize, contextMode }, 'ado_find_requirement_completeness_gaps page');

        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              _instruction: ANTI_HALLUCINATION_BANNER,
              scope: {
                project: resolvedProject,
                sourceType: resolvedSourceType,
                totalMatched,
              },
              pageInfo: buildPageInfo(totalMatched, offset, effectivePageSize, items.length, nextCursor),
              contextMode,
              items: items.map(toContextItem),
              ...(peerGroupIds !== undefined ? { peerGroupIds } : {}),
              fetchMetadata: {
                project: resolvedProject,
                apiVersion: config.adoApiVersion,
                fetchedAt: new Date().toISOString(),
                toolName: 'ado_find_requirement_completeness_gaps',
                itemCount: items.length,
                traceabilityLinkTokens: traceTokens,
                warnings: allWarnings,
              },
              missingData,
            }, 2),
          }],
        };
      } catch (err) {
        const { url, status, method } = extractHttpErrorMeta(err);
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, url, status, method: typeof method === 'string' ? method.toUpperCase() : method }, 'ado_find_requirement_completeness_gaps failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_find_requirement_consistency_candidates ────────────────────────────

  server.tool(
    'ado_find_requirement_consistency_candidates',
    CONTEXT_ONLY_NOTICE + ' ' +
    'Fetches ONE PAGE of work items and groups them structurally (by parent, field value, or shared title tokens). ' +
    'Returns the raw items plus group membership so the LLM can compare pairs and identify conflicts itself. ' +
    'To analyze the full scope, iterate: call the tool, read items[], if pageInfo.isComplete=false call again with cursor=pageInfo.nextCursor, accumulate items, repeat until isComplete=true. Never reason about items you have not yet received. ' +
    'The LLM must apply consistency rules (from the system prompt, Knowledge/RAG, and/or user prompt) to the returned context. ' +
    'Groups with only 1 member are excluded. Groups exceeding maxGroupSize are flagged in warnings.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      comparisonMode: z.enum(['parent', 'field', 'title-tokens']).describe(
        'How to group items structurally. "parent" groups by parent work item (requires relations), ' +
        '"field" groups by comparisonField value, "title-tokens" groups by shared leading title tokens.'
      ),
      comparisonField: z.string().optional().describe(
        'Field reference name for grouping when comparisonMode="field" (e.g. Custom.SubSystem).'
      ),
      maxGroupSize: z.number().int().min(2).max(100).optional().default(25).describe(
        'Groups larger than this are flagged in warnings metadata. Default 25.'
      ),
      cursor: z.string().optional().describe(
        'Pagination cursor from a previous call\'s pageInfo.nextCursor. Omit for first page.'
      ),
      pageSize: z.number().int().positive().max(200).optional()
        .describe(`Items per page. Default ${config.adoPageSizeDefault}, max ${config.adoPageSizeMax}.`),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in context fields. Refs not present in the collection are dropped and reported in fetchMetadata.warnings.'
      ),
    },
    async ({ pat, project, source, comparisonMode, comparisonField, maxGroupSize, cursor, pageSize, extraFields }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const effectivePageSize = Math.min(pageSize ?? config.adoPageSizeDefault, config.adoPageSizeMax);

        const paginationResult = await resolvePaginationState(cursor, scope, effectivePageSize, reviewScopeResolver, scopeSnapshotCache, logger);
        if ('isError' in paginationResult) return paginationResult;
        const { allIds, offset, totalMatched, snapshotId, resolvedProject, resolvedSourceType, warnings: scopeWarnings } = paginationResult;

        const pageIds = allIds.slice(offset, offset + effectivePageSize);

        const extras = [
          ...config.adoReviewExtraFields,
          ...(extraFields ?? []),
          ...(comparisonField ? [comparisonField] : []),
        ];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);

        const items = await workItemService.fetchMany(pageIds, auth, {
          fields: reviewFields,
          expand: comparisonMode === 'parent' ? 'relations' : undefined,
        }, resolvedProject);

        // Build structural groups — no pair comparison, no analysis
        let rawGroups: Array<{ groupKey: string; groupBy: string; memberIds: number[] }>;
        if (comparisonMode === 'parent') {
          rawGroups = structuralGroupByParent(items);
        } else if (comparisonMode === 'field') {
          if (!comparisonField) {
            return { content: [{ type: 'text' as const, text: 'comparisonField is required when comparisonMode is "field".' }], isError: true };
          }
          rawGroups = structuralGroupByField(items, comparisonField);
        } else {
          rawGroups = structuralGroupByTitleTokens(items);
        }

        const oversizedGroups = rawGroups.filter((g) => g.memberIds.length > maxGroupSize);
        const groups = rawGroups.filter((g) => g.memberIds.length <= maxGroupSize);

        const nextOffset = offset + effectivePageSize;
        const nextCursor = nextOffset < allIds.length
          ? encodeCursor(snapshotId, nextOffset)
          : null;

        const allWarnings: string[] = [
          ...scopeWarnings,
          ...(dropped.length ? [`Fields not found in collection and dropped: ${dropped.join(', ')}`] : []),
          ...(discoveryError ? [`Field discovery unavailable: ${discoveryError}`] : []),
          ...(oversizedGroups.length ? [`${oversizedGroups.length} group(s) exceeded maxGroupSize (${maxGroupSize}) and are excluded from the groups list.`] : []),
        ];

        logger.info({ totalMatched, fetched: items.length, offset, effectivePageSize, groups: groups.length, oversized: oversizedGroups.length, comparisonMode }, 'ado_find_requirement_consistency_candidates page');

        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              _instruction: ANTI_HALLUCINATION_BANNER,
              scope: {
                project: resolvedProject,
                sourceType: resolvedSourceType,
                totalMatched,
              },
              pageInfo: buildPageInfo(totalMatched, offset, effectivePageSize, items.length, nextCursor),
              comparisonMode,
              groups,
              items: items.map(toContextItem),
              fetchMetadata: {
                project: resolvedProject,
                apiVersion: config.adoApiVersion,
                fetchedAt: new Date().toISOString(),
                toolName: 'ado_find_requirement_consistency_candidates',
                itemCount: items.length,
                warnings: allWarnings,
              },
              missingData: oversizedGroups.length > 0 ? [
                {
                  type: 'oversized_groups',
                  reason: 'truncated',
                  details: `Groups: ${oversizedGroups.map((g) => `${g.groupKey} (${g.memberIds.length} members)`).join('; ')}`,
                },
              ] : [],
            }, 2),
          }],
        };
      } catch (err) {
        const { url, status, method } = extractHttpErrorMeta(err);
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, url, status, method: typeof method === 'string' ? method.toUpperCase() : method }, 'ado_find_requirement_consistency_candidates failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );
}
