import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { buildToolDeps, registerAllTools } from './tools/registerTools.js';
import { rewriteDefinitionsToDefs } from './schemaCompat.js';

export async function createStdioServer(config: AppConfig, logger: Logger): Promise<void> {
  const server = new McpServer({
    name: 'elisra-mcp-ado',
    version: '0.1.0',
  });

  const deps = buildToolDeps(config, logger);
  registerAllTools(server, deps);

  // Rewrite `definitions` → `$defs` in every tool's inputSchema so that mcpo
  // (and any JSON Schema draft 2019-09+ consumer) resolves $ref correctly.
  // The MCP SDK's toJsonSchemaCompat emits `definitions` by default; mcpo expects `$defs`.
  installSchemaCompatShim(server, logger);

  const transport = new StdioServerTransport();

  logger.info(
    {
      adoOrgUrl: config.adoOrgUrl,
      adoAuthMode: config.adoAuthMode,
      adoReadOnly: config.adoReadOnly,
      adoApiVersion: config.adoApiVersion,
    },
    'elisra-mcp-ado starting'
  );

  await server.connect(transport);

  logger.info({}, 'elisra-mcp-ado stdio transport connected');
}

function installSchemaCompatShim(server: McpServer, logger: Logger): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const innerServer = (server as any).server as { _requestHandlers: Map<string, (...args: unknown[]) => unknown> };
  const origHandler = innerServer._requestHandlers.get('tools/list');
  if (!origHandler) {
    logger.warn({}, 'installSchemaCompatShim: tools/list handler not found — schema compat not applied');
    return;
  }

  innerServer._requestHandlers.set('tools/list', async (...args: unknown[]) => {
    const result = await (origHandler as (...a: unknown[]) => Promise<{ tools?: Array<{ inputSchema?: unknown }> }>)(...args);
    if (result?.tools) {
      for (const tool of result.tools) {
        if (tool.inputSchema !== undefined) {
          tool.inputSchema = rewriteDefinitionsToDefs(tool.inputSchema);
        }
      }
    }
    return result;
  });
}
