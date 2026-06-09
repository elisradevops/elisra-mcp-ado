import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import { toCompactRecord, COMPACT_FIELDS, NEVER_INCLUDE_BY_DEFAULT } from '../../services/workItemService.js';

// Fields already projected (and possibly transformed) by toCompactRecord — exclude from extras to avoid overwriting.
const COMPACT_FIELD_REFS = new Set(COMPACT_FIELDS as readonly string[]);

function pickFields(fieldMap: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (COMPACT_FIELD_REFS.has(k)) continue; // already in compact; don't overwrite transformed value
    if (Object.prototype.hasOwnProperty.call(fieldMap, k)) out[k] = fieldMap[k];
  }
  return out;
}

export function registerWorkItemTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, workItemService, wrapTool } = deps;

  server.tool(
    'ado_get_work_items_by_ids',
    'Fetch work items by a known ID list (max 200 per call) and return all of them. ' +
    'Use "overview" responseMode for type/state counts only. ' +
    'Use "ids" to confirm which IDs exist without fetching field data. ' +
    'Default mode returns compact field data for every ID supplied.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      project: z.string().min(1).describe('Project name. Required — scopes the batch API call to the project, avoiding 404s on on-prem ADO Server.'),
      ids: z.array(z.number().int().positive()).min(1).max(200).describe('Work item IDs to fetch (max 200 per call).'),
      fields: z.array(z.string()).optional().describe(
        'Field reference names to fetch. Omit for compact defaults. ' +
        'Note: Microsoft.VSTS.TCM.Steps and ReproSteps are never included unless explicitly listed here.'
      ),
      expand: z.enum(['none', 'relations', 'all']).optional().default('none').describe(
        'Include relations or all links in the response.'
      ),
      responseMode: z.enum(['overview', 'ids', 'items']).optional().default('items'),
    },
    wrapTool('ado_get_work_items_by_ids', async ({ pat, project, ids, fields, expand, responseMode }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        if (responseMode === 'ids') {
          return {
            content: [{ type: 'text' as const, text: safeJsonStringify({ ids, count: ids.length }, 2) }],
          };
        }

        // Field selection: user-provided > compact defaults (never include huge TCM fields by default)
        const requestedFields = fields
          ? fields.filter((f) => !NEVER_INCLUDE_BY_DEFAULT.has(f))
          : [...COMPACT_FIELDS];

        const fetchOptions = {
          fields: requestedFields,
          expand: expand === 'none' ? undefined : expand,
        } as const;

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

        const output = items.map((item) => {
          const compact = toCompactRecord(item);
          const extras = fields ? pickFields(item.fields, fields) : {};
          const withRelations = expand !== 'none' && item.relations ? { relations: item.relations } : {};
          return { ...compact, ...extras, ...withRelations };
        });

        logger.info({ count: items.length }, 'ado_get_work_items_by_ids succeeded');
        return {
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({
              count: items.length,
              items: output,
            }, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_get_work_items_by_ids failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }));
}
