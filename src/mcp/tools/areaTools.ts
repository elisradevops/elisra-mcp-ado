import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { AdoClassificationNode } from '../../types/ado.js';
import type { AdoGetAreaTreeOutput } from '../../types/mcp.js';

function flattenPaths(node: AdoClassificationNode, paths: string[] = []): string[] {
  if (node.path !== undefined) paths.push(node.path);
  if (node.children) {
    for (const child of node.children) {
      flattenPaths(child, paths);
    }
  }
  return paths;
}

export function registerAreaTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, areaNodesClient, wrapTool } = deps;

  server.tool(
    'ado_get_area_tree',
    'Retrieve the Area Path classification-node tree for a project. ' +
    'Returns both the raw nested tree and a flat list of all Area Path strings. ' +
    'Useful for enumerating valid Sub-Areas before classifying work items. ' +
    'Requires project. depth controls how many levels deep to fetch (default 10).',
    {
      pat: z.string().optional().describe('Azure DevOps PAT. Required when ADO_AUTH_MODE=per_request_pat.'),
      project: z.string().optional().describe('Project name. Required — org-scoped area queries 404 on on-prem TFS.'),
      depth: z.number().int().min(1).max(20).optional().default(10).describe('Tree depth (default 10).'),
    },
    wrapTool('ado_get_area_tree', async ({ pat, project, depth }) => {
      if (!project) {
        const out: AdoGetAreaTreeOutput = {
          project: '',
          depth: depth ?? 10,
          flatPaths: [],
          tree: null,
          warnings: ['project is required for area tree retrieval on on-prem TFS.'],
        };
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }], isError: true };
      }

      const auth = resolveAuthContext(config, pat);
      const resolvedDepth = depth ?? 10;

      try {
        const tree = await areaNodesClient.getAreaTree(auth, project, resolvedDepth);
        const flatPaths = flattenPaths(tree);

        const out: AdoGetAreaTreeOutput = {
          project,
          depth: resolvedDepth,
          flatPaths,
          tree,
          warnings: [],
        };

        logger.info({ project, totalNodes: flatPaths.length }, 'ado_get_area_tree succeeded');
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, project }, 'ado_get_area_tree failed');

        const out: AdoGetAreaTreeOutput = {
          project,
          depth: resolvedDepth,
          flatPaths: [],
          tree: null,
          warnings: [`Area tree fetch failed: ${message}`],
        };
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }], isError: true };
      }
    }));
}
