import { loadConfig } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { createStdioServer } from './mcp/stdioServer.js';

// Bootstrap logger (before config is fully loaded — no redaction env available yet)
const boot = createLogger({ logLevel: 'info', adoEnableDebugOutput: false });

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    boot.fatal({ err }, 'Configuration error — cannot start');
    process.exit(1);
  }

  const logger = createLogger(config);

  try {
    await createStdioServer(config, logger);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start MCP stdio server');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  boot.fatal({ err }, 'Unhandled startup error');
  process.exit(1);
});
