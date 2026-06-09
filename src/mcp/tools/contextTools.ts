import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';

const ContextOptionsSchema = {
  includeSiblings: z.boolean().optional().default(false).describe(
    'Include sibling work items (items sharing the same parent).'
  ),
  contextField: z.string().optional().describe(
    'Field reference name to use for sameField grouping (e.g. Custom.SubSystem, Custom.CustomerID, System.AreaPath). ' +
    'Returns items with the same field value as the root.'
  ),
  project: z.string().optional().describe('Project name. Auto-detected from the work item if omitted.'),
  parentDepth: z.number().int().min(1).max(3).optional().default(3).describe(
    'How many ancestor levels to include. Default: 3.'
  ),
  childrenDepth: z.number().int().min(0).max(2).optional().default(2).describe(
    'How many descendant levels to include (BFS). Default: 2.'
  ),
  descriptionMaxChars: z.number().int().positive().optional().default(2000).describe(
    'Maximum description length per item (chars, after HTML stripping). Longer descriptions are trimmed.'
  ),
};

export function registerContextTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, contextPacketService, wrapTool } = deps;

  // ── ado_build_work_item_context_packet ────────────────────────────────────

  server.tool(
    'ado_build_work_item_context_packet',
    'Build a bounded context packet for a single work item: parents (up to 3 levels), ' +
    'children (BFS up to 2 levels), traceability links (covers/coveredBy/tests), related items, ' +
    'and optionally siblings or same-field items. ' +
    'Use this to give an AI reviewer full context before asking it to assess completeness or consistency.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      id: z.number().int().positive().describe('Work item ID to build context for.'),
      ...ContextOptionsSchema,
    },
    wrapTool('ado_build_work_item_context_packet', async ({ pat, id, includeSiblings, contextField, project, parentDepth, childrenDepth, descriptionMaxChars }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        const packet = await contextPacketService.build(id, {
          project,
          includeSiblings,
          contextField,
          parentDepth,
          childrenDepth,
          descriptionMaxChars,
        }, auth);

        logger.info({
          rootId: id,
          parents: packet.parents.length,
          children: packet.children.length,
          covers: packet.covers.length,
          tests: packet.tests.length,
          siblings: packet.siblings.length,
          sameField: packet.sameField.length,
          truncated: packet.truncated.length,
        }, 'ado_build_work_item_context_packet succeeded');

        return {
          content: [{ type: 'text' as const, text: safeJsonStringify(packet, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, rootId: id }, 'ado_build_work_item_context_packet failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }));

  // ── ado_build_requirement_context_packet ─────────────────────────────────

  server.tool(
    'ado_build_requirement_context_packet',
    'Build a context packet optimized for requirement quality review. ' +
    'Same as ado_build_work_item_context_packet but defaults to including siblings and ' +
    'providing guidance on using contextField for same-subsystem or same-customer-ID analysis. ' +
    'Tip: set contextField=Custom.SubSystem or contextField=Custom.CustomerID to see peer requirements.',
    {
      pat: z.string().optional().describe('Azure DevOps PAT.'),
      id: z.number().int().positive().describe('Requirement work item ID.'),
      ...ContextOptionsSchema,
      includeSiblings: z.boolean().optional().default(true).describe(
        'Include sibling requirements (same parent). Default true for requirement context.'
      ),
    },
    wrapTool('ado_build_requirement_context_packet', async ({ pat, id, includeSiblings, contextField, project, parentDepth, childrenDepth, descriptionMaxChars }) => {
      const auth = resolveAuthContext(config, pat);

      try {
        const packet = await contextPacketService.build(id, {
          project,
          includeSiblings,
          contextField,
          parentDepth,
          childrenDepth,
          descriptionMaxChars,
        }, auth);

        logger.info({ rootId: id, preset: 'requirement' }, 'ado_build_requirement_context_packet succeeded');

        return {
          content: [{ type: 'text' as const, text: safeJsonStringify({ preset: 'requirement', ...packet }, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, rootId: id }, 'ado_build_requirement_context_packet failed');
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    }));
}
