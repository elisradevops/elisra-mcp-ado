import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { buildToolDeps, registerAllTools } from './tools/registerTools.js';

export async function createStdioServer(config: AppConfig, logger: Logger): Promise<void> {
  const server = new McpServer({
    name: 'elisra-mcp-ado',
    version: '0.1.0',
  });

  const deps = buildToolDeps(config, logger);
  registerAllTools(server, deps);

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

  logger.info('elisra-mcp-ado stdio transport connected');
}
