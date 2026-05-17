import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import { toCompactRecord, COMPACT_FIELDS, NEVER_INCLUDE_BY_DEFAULT } from '../../services/workItemService.js';
import { checkFullModeGuard } from '../../domain/responseModes.js';

export function registerWorkItemTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, workItemService } = deps;

  server.tool(
    'ado_get_work_items_by_ids',
    'Fetch work items by IDs and return them in the requested response mode. ' +
    'Default mode is "samples" (first 10 compact records). ' +
    'Use "full" to get all fields (capped by ADO_FULL_RESPONSE_MAX_ITEMS). ' +
    'Use "ids" to just confirm which IDs exist. ' +
    'Use "overview" for type/state counts only.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().optional().describe('Project name. Provide when known — scopes the batch API call to the project, avoiding 404s on on-prem ADO Server.'),
      ids: z.array(z.number().int().positive()).min(1).max(200).describe('Work item IDs to fetch (max 200 per call).'),
      fields: z.array(z.string()).optional().describe(
        'Field reference names to fetch. Omit for compact defaults. ' +
        'Note: Microsoft.VSTS.TCM.Steps and ReproSteps are never included unless explicitly listed here.'
      ),
      expand: z.enum(['none', 'relations', 'all']).optional().default('none').describe(
        'Include relations or all links in the response.'
      ),
      responseMode: z.enum(['overview', 'ids', 'samples', 'full']).optional().default('samples'),
      sampleSize: z.number().int().positive().max(50).optional().default(10).describe(
        'Number of items to return in samples mode.'
      ),
    },
    async ({ pat, project, ids, fields, expand, responseMode, sampleSize }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        // Field selection: user-provided > compact defaults (never include huge TCM fields by default)
        const requestedFields = fields
          ? fields.filter((f) => !NEVER_INCLUDE_BY_DEFAULT.has(f))
          : [...COMPACT_FIELDS];

        if (responseMode === 'ids') {
          return {
            content: [{ type: 'text' as const, text: safeJsonStringify({ ids, count: ids.length }, 2) }],
          };
        }

        const fetchOptions = {
          fields: responseMode === 'full' ? (fields ?? undefined) : requestedFields,
          expand: expand === 'none' ? undefined : expand,
        } as const;

        if (responseMode === 'full') {
          const guard = checkFullModeGuard(ids.length, config.adoFullResponseMaxItems);
          if (!guard.allowed) {
            return { content: [{ type: 'text' as const, text: guard.reason! }], isError: true };
          }
        }

        const items = await workItemService.fetchMany(ids, auth, fetchOptions, project);

        if (responseMode === 'overview') {
          const typeCounts: Record<string, number> = {};
          const stateCounts: Record<string, number> = {};
          for (const item of items) {
            const type = String(item.fields['System.WorkItemType'] ?? 'Unknown');
            const state = String(item.fields['System.State'] ?? 'Unknown');
            typeCounts[type] = (typeCounts[type] ?? 0) + 1;
            stateCounts[state] = (stateCounts[state] ?? 0) + 1;
          }
          return {
            content: [{
              type: 'text' as const,
              text: safeJsonStringify({ count: items.length, byType: typeCounts, byState: stateCounts }, 2),
            }],
          };
        }

        const sample = responseMode === 'samples' ? items.slice(0, sampleSize) : items;

        const output = sample.map((item) => {
          const compact = toCompactRecord(item);
          if (expand !== 'none' && item.relations) {
            return { ...compact, relations: item.relations };
          }
          return compact;
        });

        logger.info({ count: items.length, responseMode }, 'ado_get_work_items_by_ids succeeded');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              count: items.length,
              returned: output.length,
              items: output,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_get_work_items_by_ids failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }
  );
}
