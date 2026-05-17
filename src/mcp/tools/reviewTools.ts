import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import type { FieldDiscoveryService } from '../../services/fieldDiscoveryService.js';
import type { AuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { ReviewScope } from '../../domain/reviewScope.js';
import { summarizeFindings } from '../../domain/requirementQuality.js';
import { REVIEW_FIELDS } from '../../services/requirementReviewService.js';
import type { AdoWorkItem } from '../../types/ado.js';
import type { ContextMode } from '../../services/completenessGapService.js';
import type { ComparisonMode } from '../../services/consistencyCandidateService.js';
import { checkFullModeGuard, takeSampleIds } from '../../domain/responseModes.js';
import { FieldFilterSchema } from './scopeTools.js';
import { FilterNodeSchema } from '../../domain/fieldFilter.js';

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
      'E.g. sourceFilter=Requirement + targetFilter=Test Case with "source" → reviews Requirements; ' +
      '"target" → reviews Test Cases; "both" → full merged union (legacy).'
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
      // System.* fields are universal — short-circuit to keep warnings focused on real gaps
      if (ref.startsWith('System.') || catalog.has(ref)) {
        kept.push(ref);
      } else {
        dropped.push(ref);
      }
    }
    return { fields: kept, dropped };
  } catch (err) {
    // Discovery failure must not block the review — fall back to the full requested set.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Field discovery unavailable; falling back to full requested set');
    return { fields: deduped, dropped: [], discoveryError: message };
  }
}

const REVIEW_RESPONSE_MODES = ['overview', 'samples', 'full'] as const;
const DEFAULT_SAMPLE_SIZE = 10;
const DEFAULT_MAX_ITEMS = 200;
const DEFAULT_MAX_GROUP_SIZE = 25;

export function registerReviewTools(server: McpServer, deps: ToolDeps): void {
  const {
    config, logger, reviewScopeResolver, workItemService, fieldDiscoveryService,
    requirementReviewService, completenessGapService, consistencyCandidateService,
  } = deps;

  // ── ado_review_work_items ──────────────────────────────────────────────────

  server.tool(
    'ado_review_work_items',
    'Resolve a scope, fetch work items, and apply the 7-attribute requirement quality review ' +
    '(clear, complete, consistent, singular, verifiable, feasible, traceable). ' +
    'Single-item heuristics are applied for all attributes. ' +
    'Consistent and full completeness require context analysis (Phase 8). ' +
    'Default response mode is "overview" (risk distribution summary). Use "samples" for the first N findings or "full" for all. ' +
    'IMPORTANT: Always call ado_resolve_review_scope first to get totalMatched. ' +
    `If totalMatched > ${config.adoFullResponseMaxItems}, do NOT use responseMode="full" — use "overview" then "samples" with sampleSize=10. ` +
    '"full" mode is hard-rejected above the server cap (ADO_FULL_RESPONSE_MAX_ITEMS). ' +
    '"overview" mode skips relation fetching for performance; traceability risk may be underestimated — use "samples" to get per-item traceability findings.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      responseMode: z.enum(REVIEW_RESPONSE_MODES).optional().default('overview'),
      sampleSize: z.number().int().positive().max(50).optional().default(DEFAULT_SAMPLE_SIZE),
      maxItems: z.number().int().positive().optional().default(DEFAULT_MAX_ITEMS).describe(
        `Max work items to review in "samples"/"full" modes. "overview" always processes all matched items (capped at ADO_MAX_REVIEW_ITEMS, default 500). "full" also capped at ADO_FULL_RESPONSE_MAX_ITEMS (${config.adoFullResponseMaxItems}).`
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in REVIEW_FIELDS and ADO_REVIEW_EXTRA_FIELDS env. ' +
        'Refs not present in the collection are dropped and reported in warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links on relation rel names. ' +
        'Default: ADO_TRACEABILITY_LINK_TOKENS env (Affects, CoveredBy, TestedBy). ' +
        'Example: ["Affects","CoveredBy","Implements"] to recognize Custom.Implements-* links.'
      ),
    },
    async ({ pat, project, source, responseMode, sampleSize, maxItems, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);

        // overview: process everything (server-side cap); full: guard payload size; samples: caller cap
        const cap = responseMode === 'overview'
          ? Math.min(resolution.ids.length, config.adoMaxReviewItems)
          : responseMode === 'full'
            ? Math.min(maxItems, config.adoFullResponseMaxItems)
            : maxItems;

        if (responseMode === 'full') {
          const guard = checkFullModeGuard(resolution.ids.length, cap);
          if (!guard.allowed) {
            return { content: [{ type: 'text' as const, text: guard.reason! }], isError: true };
          }
        }

        const ids = resolution.ids.slice(0, cap);
        const extras = [...config.adoReviewExtraFields, ...(extraFields ?? [])];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);
        // overview skips relations to avoid 404 from deleted/cross-project IDs and reduce payload size.
        // Traceability findings are suppressed in overview; use "samples" to see them per-item.
        const expandMode = responseMode === 'overview' ? 'none' : 'relations';
        const items = await workItemService.fetchMany(ids, auth, {
          fields: reviewFields,
          expand: expandMode,
        });

        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;
        const allFindings = requirementReviewService.review(items, { traceabilityTokens: traceTokens });
        const summary = summarizeFindings(allFindings);
        const warnings = [
          ...resolution.warnings,
          ...(dropped.length ? [{ kind: 'missing_fields', fields: dropped }] : []),
          ...(discoveryError ? [{ kind: 'field_discovery_unavailable', message: discoveryError }] : []),
          ...(responseMode === 'overview' ? [{ kind: 'traceability_skipped', message: 'Traceability links not evaluated in overview mode. Use responseMode="samples" for per-item traceability findings.' }] : []),
        ];

        if (responseMode === 'overview') {
          const highRiskIds = allFindings.filter((f) => f.overallRisk === 'high').map((f) => f.workItemId);
          logger.info({ totalReviewed: allFindings.length }, 'ado_review_work_items overview');
          return {
            content: [{
              type: 'text' as const,
              text: safeJsonStringify({
                project: resolution.project,
                sourceType: resolution.sourceType,
                totalMatched: resolution.totalMatched,
                reviewed: allFindings.length,
                summary,
                sampleHighRiskIds: takeSampleIds(highRiskIds),
                warnings,
              }, 2),
            }],
          };
        }

        const sample = responseMode === 'samples' ? allFindings.slice(0, sampleSize) : allFindings;

        logger.info({ totalReviewed: allFindings.length, returned: sample.length, responseMode }, 'ado_review_work_items findings');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project: resolution.project,
              sourceType: resolution.sourceType,
              totalMatched: resolution.totalMatched,
              reviewed: allFindings.length,
              returned: sample.length,
              summary,
              findings: sample,
              warnings,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, responseMode, sourceType: source.type }, 'ado_review_work_items failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_review_requirements ───────────────────────────────────────────────

  server.tool(
    'ado_review_requirements',
    'Review work items as requirements using the 7-attribute quality model ' +
    '(clear, complete, consistent, singular, verifiable, feasible, traceable). ' +
    'This is a focused wrapper for requirement-type work items. ' +
    'Tip: add a fieldFilters source with System.WorkItemType IN ["Requirement","Feature"] to scope to requirement types. ' +
    'IMPORTANT: Always call ado_resolve_review_scope first to get totalMatched. ' +
    `If totalMatched > ${config.adoFullResponseMaxItems}, do NOT use responseMode="full" — use "overview" then "samples" with sampleSize=10. ` +
    '"full" mode is hard-rejected above the server cap (ADO_FULL_RESPONSE_MAX_ITEMS). ' +
    '"overview" mode skips relation fetching for performance; traceability risk may be underestimated — use "samples" for per-item traceability findings. ' +
    'See ado_review_work_items for full parameter reference.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      responseMode: z.enum(REVIEW_RESPONSE_MODES).optional().default('overview'),
      sampleSize: z.number().int().positive().max(50).optional().default(DEFAULT_SAMPLE_SIZE),
      maxItems: z.number().int().positive().optional().default(DEFAULT_MAX_ITEMS).describe(
        `Max items returned in "samples"/"full" modes. "full" is capped at ADO_FULL_RESPONSE_MAX_ITEMS (currently ${config.adoFullResponseMaxItems}) and hard-rejected above it. "overview" always processes all matched items (up to ADO_MAX_REVIEW_ITEMS, default 500).`
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in REVIEW_FIELDS and ADO_REVIEW_EXTRA_FIELDS env. ' +
        'Refs not present in the collection are dropped and reported in warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links on relation rel names. ' +
        'Default: ADO_TRACEABILITY_LINK_TOKENS env (Affects, CoveredBy, TestedBy). ' +
        'Example: ["Affects","CoveredBy","Implements"] to recognize Custom.Implements-* links.'
      ),
    },
    async ({ pat, project, source, responseMode, sampleSize, maxItems, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source, preset: 'requirement_quality' };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);

        const cap = responseMode === 'overview'
          ? Math.min(resolution.ids.length, config.adoMaxReviewItems)
          : responseMode === 'full'
            ? Math.min(maxItems, config.adoFullResponseMaxItems)
            : maxItems;

        if (responseMode === 'full') {
          const guard = checkFullModeGuard(resolution.ids.length, cap);
          if (!guard.allowed) {
            return { content: [{ type: 'text' as const, text: guard.reason! }], isError: true };
          }
        }

        const ids = resolution.ids.slice(0, cap);
        const extras = [...config.adoReviewExtraFields, ...(extraFields ?? [])];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);
        // overview skips relations to avoid 404 from deleted/cross-project IDs and reduce payload size.
        const expandMode = responseMode === 'overview' ? 'none' : 'relations';
        const items = await workItemService.fetchMany(ids, auth, {
          fields: reviewFields,
          expand: expandMode,
        });

        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;
        const allFindings = requirementReviewService.review(items, { traceabilityTokens: traceTokens });
        const summary = summarizeFindings(allFindings);
        const warnings = [
          ...resolution.warnings,
          ...(dropped.length ? [{ kind: 'missing_fields', fields: dropped }] : []),
          ...(discoveryError ? [{ kind: 'field_discovery_unavailable', message: discoveryError }] : []),
          ...(responseMode === 'overview' ? [{ kind: 'traceability_skipped', message: 'Traceability links not evaluated in overview mode. Use responseMode="samples" for per-item traceability findings.' }] : []),
        ];

        const sample = responseMode === 'samples' ? allFindings.slice(0, sampleSize) : allFindings;
        const includeFindings = responseMode !== 'overview';

        logger.info({ totalReviewed: allFindings.length, responseMode }, 'ado_review_requirements');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project: resolution.project,
              preset: 'requirement_quality',
              totalMatched: resolution.totalMatched,
              reviewed: allFindings.length,
              ...(includeFindings ? { returned: sample.length } : {}),
              summary,
              ...(includeFindings ? { findings: sample } : {}),
              warnings,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, responseMode, sourceType: source.type }, 'ado_review_requirements failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_find_requirement_completeness_gaps ────────────────────────────────

  server.tool(
    'ado_find_requirement_completeness_gaps',
    'Analyze a set of work items for completeness gaps at three levels: ' +
    'L1 (single-item: missing description, acceptance criteria, verification method), ' +
    'L2 (linked-context: missing traceability links), ' +
    'L3 (peer-context: fields present in siblings/sameField peers but absent here). ' +
    'L2 requires relations to be fetched; L3 requires groupField. ' +
    'Returns gap findings grouped by work item with gap counts by level and kind.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      contextMode: z.enum(['L1', 'L2', 'L3']).optional().default('L2').describe(
        'Analysis depth. L1=single-item, L2=+linked context, L3=+peer comparison.'
      ),
      groupField: z.string().optional().describe(
        'Field to group items for L3 peer analysis (e.g. System.AreaPath, Custom.SubSystem). Required for L3.'
      ),
      maxItems: z.number().int().positive().optional().default(DEFAULT_MAX_ITEMS).describe(
        'Max items to analyze. Default 200. Server cap: ADO_MAX_REVIEW_ITEMS (default 500).'
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in REVIEW_FIELDS and ADO_REVIEW_EXTRA_FIELDS env. ' +
        'Refs not present in the collection are dropped and reported in warnings.'
      ),
      traceabilityLinkTokens: z.array(z.string()).optional().describe(
        'Substring tokens used to recognize traceability links on relation rel names. ' +
        'Default: ADO_TRACEABILITY_LINK_TOKENS env (Affects, CoveredBy, TestedBy). ' +
        'Example: ["Affects","CoveredBy","Implements"] to recognize Custom.Implements-* links.'
      ),
    },
    async ({ pat, project, source, contextMode, groupField, maxItems, extraFields, traceabilityLinkTokens }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);
        const ids = resolution.ids.slice(0, Math.min(maxItems, config.adoMaxReviewItems));
        const needsRelations = contextMode === 'L2' || contextMode === 'L3';

        const extras = [
          ...config.adoReviewExtraFields,
          ...(extraFields ?? []),
          ...(groupField ? [groupField] : []),
        ];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);
        const items = await workItemService.fetchMany(ids, auth, {
          fields: reviewFields,
          expand: needsRelations ? 'relations' : undefined,
        });

        let peerGroups: Map<number, AdoWorkItem[]> | undefined;

        if (contextMode === 'L3' && groupField) {
          // Build peer groups: items sharing the same groupField value
          const byFieldValue = new Map<string, AdoWorkItem[]>();
          for (const item of items) {
            const v = item.fields[groupField];
            if (v === undefined || v === null || v === '') continue;
            const key = String(v);
            if (!byFieldValue.has(key)) byFieldValue.set(key, []);
            byFieldValue.get(key)!.push(item);
          }

          peerGroups = new Map<number, AdoWorkItem[]>();
          for (const group of byFieldValue.values()) {
            for (const item of group) {
              // Peers = all group members except self
              peerGroups.set(item.id, group.filter((p) => p.id !== item.id));
            }
          }
        }

        const traceTokens = traceabilityLinkTokens ?? config.adoTraceabilityLinkTokens;
        const report = completenessGapService.analyze(
          items, contextMode as ContextMode, peerGroups, { traceabilityTokens: traceTokens }
        );

        const completenessWarnings = [
          ...resolution.warnings,
          ...(dropped.length ? [{ kind: 'missing_fields', fields: dropped }] : []),
          ...(discoveryError ? [{ kind: 'field_discovery_unavailable', message: discoveryError }] : []),
        ];

        logger.info({
          totalAnalyzed: report.totalAnalyzed,
          totalWithGaps: report.totalWithGaps,
          contextMode,
        }, 'ado_find_requirement_completeness_gaps succeeded');

        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project: resolution.project,
              totalMatched: resolution.totalMatched,
              analyzed: report.totalAnalyzed,
              contextMode,
              ...report,
              warnings: completenessWarnings,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_find_requirement_completeness_gaps failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );

  // ── ado_find_requirement_consistency_candidates ────────────────────────────

  server.tool(
    'ado_find_requirement_consistency_candidates',
    'Find pairs of requirements that may conflict or overlap, using grouping-first analysis. ' +
    'Groups items by parent, field value, or shared title tokens, then compares pairs within each group. ' +
    'Detects: near-duplicate titles, conflicting numeric thresholds, contradictory "shall/shall not" patterns. ' +
    'Groups exceeding maxGroupSize are skipped to avoid O(N²) cost — narrow the scope or increase maxGroupSize. ' +
    'Findings are labeled as "candidates" — human review is required to confirm actual conflicts.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name.'),
      source: ValidatedSourceSchema,
      comparisonMode: z.enum(['parent', 'field', 'title-tokens']).describe(
        'How to group items before comparing. "parent" groups by parent work item, ' +
        '"field" groups by comparisonField value, "title-tokens" groups by shared title tokens.'
      ),
      comparisonField: z.string().optional().describe(
        'Field reference name for grouping when comparisonMode="field" (e.g. Custom.SubSystem).'
      ),
      maxGroupSize: z.number().int().min(2).max(100).optional().default(DEFAULT_MAX_GROUP_SIZE).describe(
        'Groups larger than this are skipped — prevents O(N²). Default 25.'
      ),
      maxItems: z.number().int().positive().optional().default(DEFAULT_MAX_ITEMS).describe(
        'Max items to analyze. Default 200. Server cap: ADO_MAX_REVIEW_ITEMS (default 500).'
      ),
      extraFields: z.array(z.string()).optional().describe(
        'Additional field reference names to fetch (e.g. Custom.SPAWBS, Custom.SubModule). ' +
        'Merged with built-in REVIEW_FIELDS and ADO_REVIEW_EXTRA_FIELDS env. ' +
        'Refs not present in the collection are dropped and reported in warnings.'
      ),
    },
    async ({ pat, project, source, comparisonMode, comparisonField, maxGroupSize, maxItems, extraFields }) => {
      const auth = resolveAuthContext(config, pat);
      const scope: ReviewScope = { project, auth, source };

      try {
        const resolution = await reviewScopeResolver.resolve(scope);
        const ids = resolution.ids.slice(0, Math.min(maxItems, config.adoMaxReviewItems));

        // Need relations for 'parent' mode (to read Hierarchy-Reverse links)
        const extras = [
          ...config.adoReviewExtraFields,
          ...(extraFields ?? []),
          ...(comparisonField ? [comparisonField] : []),
        ];
        const { fields: reviewFields, dropped, discoveryError } =
          await resolveAvailableReviewFields(fieldDiscoveryService, auth, project, extras, logger);
        const items = await workItemService.fetchMany(ids, auth, {
          fields: reviewFields,
          expand: comparisonMode === 'parent' ? 'relations' : undefined,
        });

        const result = consistencyCandidateService.findCandidates(
          items,
          comparisonMode as ComparisonMode,
          { comparisonField, maxGroupSize }
        );

        logger.info({
          totalAnalyzed: result.totalAnalyzed,
          totalGroups: result.totalGroups,
          candidatePairs: result.candidatePairs.length,
          truncatedGroups: result.truncatedGroups.length,
          comparisonMode,
        }, 'ado_find_requirement_consistency_candidates succeeded');

        const consistencyWarnings = [
          ...resolution.warnings,
          ...(dropped.length ? [{ kind: 'missing_fields', fields: dropped }] : []),
          ...(discoveryError ? [{ kind: 'field_discovery_unavailable', message: discoveryError }] : []),
        ];

        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              project: resolution.project,
              totalMatched: resolution.totalMatched,
              analyzed: result.totalAnalyzed,
              comparisonMode,
              ...result,
              warnings: consistencyWarnings,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_find_requirement_consistency_candidates failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );
}
