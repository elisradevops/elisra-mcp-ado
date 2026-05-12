import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import { createDefaultCompiler } from '../../domain/genericWiqlCompiler.js';

const OperatorEnum = z.enum(['=', '<>', 'IN', 'NOT IN', '<', '<=', '>', '>=', 'CONTAINS', 'UNDER', 'NOT UNDER']);

/**
 * Register debug tools. Only called when ADO_ENABLE_DEBUG_OUTPUT=true.
 * These tools are intentionally not listed in the public tool surface.
 */
export function registerDebugTools(server: McpServer, deps: ToolDeps): void {
  const { config } = deps;

  if (!config.adoEnableDebugOutput) return;

  // ── ado_debug_compile_wiql ──────────────────────────────────────────────────

  server.tool(
    'ado_debug_compile_wiql',
    '[DEBUG] Compile a field-filter list to a WIQL string without executing it. ' +
    'Only available when ADO_ENABLE_DEBUG_OUTPUT=true. ' +
    'Use to inspect the generated WIQL before running a full scope query.',
    {
      project: z.string().describe('Project name. Injected into the WIQL [System.TeamProject] clause.'),
      filters: z.array(z.object({
        field: z.string(),
        operator: OperatorEnum,
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
      })).min(1).describe('Field filter conditions (ANDed together).'),
      orderBy: z.array(z.object({
        field: z.string(),
        direction: z.enum(['ASC', 'DESC']),
      })).optional().describe('ORDER BY clause.'),
    },
    ({ project, filters, orderBy }) => {
      try {
        const compiler = createDefaultCompiler(config.adoAllowUnknownFields);
        const { wiql, warnings } = compiler.compile({ project, filters, orderBy });

        return Promise.resolve({
          content: [{
            type: 'text' as const,
            text: safeJsonStringify({ wiql, warnings }, 2),
          }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Promise.resolve({ content: [{ type: 'text' as const, text: message }], isError: true });
      }
    }
  );
}
