import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './registerTools.js';
import { resolveAuthContext } from '../../auth/authContext.js';
import { safeJsonStringify } from '../../utils/safeJson.js';
import type { AdoPingOutput, AdoCheckPatOutput } from '../../types/mcp.js';

const patParam = z.string().optional().describe(
  'Azure DevOps PAT. Required when ADO_AUTH_MODE=per_request_pat.'
);

export function registerHealthTools(server: McpServer, deps: ToolDeps): void {
  const { config, logger, projectsClient } = deps;

  server.tool(
    'ado_ping',
    'Ping Azure DevOps Server and return the collection URL, top 10 available projects, API version, and server version. Use this to verify connectivity and PAT validity before running other tools.',
    { pat: patParam },
    async ({ pat }) => {
      const auth = resolveAuthContext(config, pat);
      try {
        const [projects, connectionData] = await Promise.all([
          projectsClient.listProjects(auth, 10),
          projectsClient.getConnectionData(auth).catch(() => null),
        ]);

        const result: AdoPingOutput = {
          collection: config.adoOrgUrl,
          projects: projects.map((p) => ({ id: p.id, name: p.name, state: p.state })),
          apiVersion: config.adoApiVersion,
          serverVersion: connectionData?.serverVersion,
        };

        logger.info({ projectCount: projects.length }, 'ado_ping succeeded');
        return { content: [{ type: 'text' as const, text: safeJsonStringify(result, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, 'ado_ping failed');
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'ado_check_pat',
    'Validate a PAT against Azure DevOps Server and return the authenticated user identity. Use this to confirm a PAT is valid before starting a review session.',
    { pat: patParam },
    async ({ pat }) => {
      const auth = resolveAuthContext(config, pat);
      if (!auth.pat) {
        const out: AdoCheckPatOutput = {
          valid: false,
          message: 'No PAT provided. Supply auth.pat or set ADO_AUTH_MODE=server_pat.',
        };
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }], isError: true };
      }

      try {
        const connectionData = await projectsClient.getConnectionData(auth);
        const user = connectionData.authenticatedUser;
        const out: AdoCheckPatOutput = {
          valid: true,
          displayName: user?.providerDisplayName,
          id: user?.id,
        };
        logger.info({ displayName: user?.providerDisplayName }, 'ado_check_pat: PAT is valid');
        return { content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const out: AdoCheckPatOutput = { valid: false, message };
        logger.warn({ err }, 'ado_check_pat: PAT validation failed');
        return {
          content: [{ type: 'text' as const, text: safeJsonStringify(out, 2) }],
          isError: true,
        };
      }
    }
  );
}
