import { createServer as createNodeServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { createConfiguredMcpServer } from './createServer.js';

function makeBearerAuth(expectedToken: string) {
  const expectedBuf = Buffer.from(`Bearer ${expectedToken}`);
  return function bearerAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'] ?? '';
    const authBuf = Buffer.from(authHeader);
    const valid =
      authBuf.length === expectedBuf.length &&
      timingSafeEqual(authBuf, expectedBuf);
    if (!valid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

export async function createHttpServer(config: AppConfig, logger: Logger): Promise<Server> {
  const bearerToken = config.mcpHttpBearerToken!;

  const allowedHosts =
    config.mcpAllowedHosts.length > 0 ? config.mcpAllowedHosts : undefined;

  const app = createMcpExpressApp({
    host: config.mcpHttpHost,
    allowedHosts,
  });

  // CORS — activate only when origins are explicitly configured
  if (config.mcpAllowedOrigins.length > 0) {
    const origins = new Set(config.mcpAllowedOrigins);
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers['origin'];
      if (origin && origins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  // Unauthenticated liveness probe
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  const auth = makeBearerAuth(bearerToken);

  // All MCP routes require bearer auth
  app.use(config.mcpHttpPath, auth);

  async function handleMcp(req: Request, res: Response): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const { server } = createConfiguredMcpServer(config, logger, { applyMcpoSchemaCompat: false });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      // cleanup after handleRequest resolves or throws (stateless — no session to preserve)
      await transport.close();
      await server.close();
    }
  }

  function mcpRoute(req: Request, res: Response): void {
    handleMcp(req, res).catch((err: unknown) => {
      logger.error({ err }, 'MCP request handler error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  app.post(config.mcpHttpPath, mcpRoute);
  app.get(config.mcpHttpPath, mcpRoute);
  app.delete(config.mcpHttpPath, mcpRoute);

  const httpServer = createNodeServer(app);

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(config.mcpHttpPort, config.mcpHttpHost, () => {
      logger.info(
        {
          transport: 'http',
          host: config.mcpHttpHost,
          port: config.mcpHttpPort,
          path: config.mcpHttpPath,
          adoOrgUrl: config.adoOrgUrl,
          adoAuthMode: config.adoAuthMode,
          adoApiVersion: config.adoApiVersion,
          bearerToken: 'present',
        },
        'elisra-mcp-ado HTTP transport listening'
      );
      resolve(httpServer);
    });
  });
}
