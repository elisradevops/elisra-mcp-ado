import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { createConfiguredMcpServer } from './createServer.js';

export async function createStdioServer(config: AppConfig, logger: Logger): Promise<void> {
  const { server } = createConfiguredMcpServer(config, logger, { applyMcpoSchemaCompat: true });

  const transport = new StdioServerTransport();

  logger.info(
    {
      transport: 'stdio',
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
