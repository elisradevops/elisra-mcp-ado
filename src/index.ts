import { loadConfig } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { createStdioServer } from './mcp/stdioServer.js';
import { createHttpServer } from './mcp/httpServer.js';
import { connectMongo, disconnectMongo } from './db/mongoClient.js';
import { AdoCredentialRepository } from './credentials/adoCredentialRepository.js';
import { UserPatResolver } from './credentials/userPatResolver.js';
import { AdoClient } from './ado/adoClient.js';
import { ProjectsClient } from './ado/projectsClient.js';
import { AdoConnectionService } from './lifecycle/adoConnectionService.js';
import type { HttpServerP1Deps } from './mcp/httpServer.js';
import { WriteApprovalStore } from './approvals/writeApprovalStore.js';

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

  // ── P1: Bootstrap MongoDB + per-user credential infrastructure ────────────
  let p1Deps: HttpServerP1Deps | undefined;

  if (config.adoAuthMode === 'trusted_user_header') {
    try {
      const { db } = await connectMongo(config.mongoUri!, config.mongoDbName, logger);
      const repo = new AdoCredentialRepository(db, config.adoCredentialsCollection);
      await repo.ensureIndexes(logger);

      // AdoClient + ProjectsClient for PAT validation during lifecycle ops
      const adoClient = new AdoClient(config, logger);
      const projectsClient = new ProjectsClient(adoClient, config);

      const userPatResolver = new UserPatResolver(repo, logger);
      const adoConnectionService = new AdoConnectionService(
        repo,
        projectsClient,
        config.patEncryptionKeyB64!,
        config.patEncryptionKeyId,
        logger,
      );

      const writeApprovalStore = new WriteApprovalStore(
        db.collection(config.adoWriteApprovalsCollection),
        logger,
      );
      await writeApprovalStore.ensureIndexes();

      p1Deps = {
        userPatResolver,
        adoConnectionService,
        p2: { writeApprovalStore },
      };
      logger.info({ dbName: config.mongoDbName }, 'P1+P2 credential and approval infrastructure ready');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize P1 credential infrastructure — cannot start in trusted_user_header mode');
      process.exit(1);
    }
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    if (config.adoAuthMode === 'trusted_user_header') {
      await disconnectMongo(logger);
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  try {
    if (config.mcpTransport === 'http') {
      await createHttpServer(config, logger, p1Deps);
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
