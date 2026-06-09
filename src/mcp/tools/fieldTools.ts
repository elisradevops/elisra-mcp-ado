import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { AdoDiscoverFieldsOutput } from '../../types/mcp.js';

export function registerFieldTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, fieldDiscoveryService, wrapTool } = deps;

  server.tool(
    'ado_discover_fields',
    'Discover all work-item fields available in the Azure DevOps collection. ' +
    'Returns field reference names, types, allowed filter operators, and DocGen-alignment hints. ' +
    'Results are cached for 1 hour per collection. Use refresh=true to force a re-fetch. ' +
    'Optionally filter to fields applicable for a specific work item type by supplying project + workItemType.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT. Required when ADO_AUTH_MODE=per_request_pat.'),
      project: z.string().optional().describe('Project name. Required when workItemType is specified.'),
      workItemType: z.string().optional().describe('Filter to fields used by this work item type (e.g. "Requirement", "Bug").'),
      refresh: z.boolean().optional().default(false).describe('Force cache invalidation and re-fetch from ADO.'),
    },
    wrapTool('ado_discover_fields', async ({ pat, project, workItemType, refresh }) => {
      const auth = resolveAuthContext(config, pat);
      const warnings: string[] = [];

      if (workItemType && !project) {
        const out: AdoDiscoverFieldsOutput = {
          totalFields: 0,
          source: 'seed_fallback',
          fields: [],
          warnings: ['workItemType filter requires project to be specified. Ignoring workItemType.'],
        };
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }], isError: true };
      }

      try {
        const catalog = await fieldDiscoveryService.discover({
          auth,
          project,
          workItemType,
          refresh,
        });

        const fields = Array.from(catalog.values()).map((f) => ({
          referenceName: f.referenceName,
          displayName: f.displayName,
          type: f.type,
          isCustom: f.isCustom,
          isIdentity: f.isIdentity,
          isLongText: f.isLongText,
          isTreePath: f.isTreePath,
          allowedOperators: [...f.allowedOperators],
          knownInDocGen: f.knownInDocGen,
          safeForFiltering: f.safeForFiltering,
          safeForGrouping: f.safeForGrouping,
          source: f.source,
        }));

        // Sort: custom first (DocGen fields prominent), then system, alphabetically within each group
        fields.sort((a, b) => {
          if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
          return a.referenceName.localeCompare(b.referenceName);
        });

        const hadDiscovered = fields.some((f) => f.source === 'discovered');

        const out: AdoDiscoverFieldsOutput = {
          totalFields: fields.length,
          source: hadDiscovered ? 'discovered' : 'seed_fallback',
          fields,
          warnings,
        };

        logger.info({ totalFields: fields.length, hadDiscovered }, 'ado_discover_fields succeeded');
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_discover_fields failed — falling back to seed catalog');

        // Graceful fallback: return seed catalog with a warning
        const { buildSeedCatalog } = await import('../../domain/adoFields.js');
        const seed = buildSeedCatalog();
        const fields = Array.from(seed.values()).map((f) => ({
          referenceName: f.referenceName,
          displayName: f.displayName,
          type: f.type,
          isCustom: f.isCustom,
          isIdentity: f.isIdentity,
          isLongText: f.isLongText,
          isTreePath: f.isTreePath,
          allowedOperators: [...f.allowedOperators],
          knownInDocGen: f.knownInDocGen,
          safeForFiltering: f.safeForFiltering,
          safeForGrouping: f.safeForGrouping,
          source: f.source,
        }));

        const out: AdoDiscoverFieldsOutput = {
          totalFields: fields.length,
          source: 'seed_fallback',
          fields,
          warnings: [`Field discovery failed: ${message}. Returning seed catalog (${fields.length} fields).`],
        };
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }], isError: true };
      }
    }));
}
