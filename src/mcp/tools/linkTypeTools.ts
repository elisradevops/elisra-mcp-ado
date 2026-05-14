import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';

export function registerLinkTypeTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, linkTypeDiscoveryService } = deps;

  server.tool(
    'ado_discover_link_types',
    'Discover all work-item relation/link types available in the Azure DevOps collection. ' +
    'Returns reference names, display names, and semantic hints so you can build accurate linkTypes arrays ' +
    'for ado_resolve_review_scope, ado_review_work_items, and ado_review_requirements. ' +
    'Results are cached for 1 hour. Use refresh=true to force a re-fetch. ' +
    'By default returns only workItemLink types (the ones usable in linkTypes arrays). ' +
    'Use includeAll=true to also see resource links (ArtifactLink, Hyperlink, AttachedFile).',
    {
      pat: z.string().optional().describe('Azure DevOps PAT. Required when ADO_AUTH_MODE=per_request_pat.'),
      includeAll: z.boolean().optional().default(false).describe(
        'Include non-work-item link types (ArtifactLink, Hyperlink, AttachedFile, resourceLink, remoteWorkItemLink). Default: workItemLink only.'
      ),
      refresh: z.boolean().optional().default(false).describe(
        'Force cache invalidation and re-fetch from ADO.'
      ),
    },
    async ({ pat, includeAll, refresh }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        const out = await linkTypeDiscoveryService.discover({ auth, includeAll, refresh });
        logger.info({ totalLinkTypes: out.totalLinkTypes, source: out.source }, 'ado_discover_link_types succeeded');
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_discover_link_types failed — falling back to seed catalog');
        const out = linkTypeDiscoveryService.buildSeedFallback(message, includeAll ?? false);
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }] };
      }
    }
  );
}
