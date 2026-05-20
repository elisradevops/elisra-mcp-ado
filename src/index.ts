import { loadConfig } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { createStdioServer } from './mcp/stdioServer.js';
import { createHttpServer } from './mcp/httpServer.js';

// Bootstrap logger (before config is fully loaded — no redaction env available yet)
const boot = createLogger({ logLevel: 'info', adoEnableDebugOutput: false });

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    boot.error({ err }, 'Configuration error — cannot start');
    process.exit(1);
  }

  const logger = createLogger(config);

  try {
    if (config.mcpTransport === 'http') {
      await createHttpServer(config, logger);
    } else {
      await createStdioServer(config, logger);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to start MCP server');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  boot.error({ err }, 'Unhandled startup error');
  process.exit(1);
});
