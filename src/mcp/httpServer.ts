import { createServer as createNodeServer } from 'node:http';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { createConfiguredMcpServer } from './createServer.js';
import { extractTrustedIdentity } from '../auth/trustedIdentity.js';
import { requestContextStorage } from '../utils/requestContext.js';
import { generateRequestId } from '../utils/requestId.js';
import { SimpleRateLimiter } from '../utils/rateLimiter.js';
import type { UserPatResolver } from '../credentials/userPatResolver.js';
import type { AdoConnectionService } from '../lifecycle/adoConnectionService.js';
import { createAdoConnectionRouter } from '../lifecycle/adoConnectionRoutes.js';
import type { P2Deps } from './tools/registerTools.js';

export interface HttpServerP1Deps {
  userPatResolver: UserPatResolver;
  adoConnectionService: AdoConnectionService;
  p2?: P2Deps;
}

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

export async function createHttpServer(
  config: AppConfig,
  logger: Logger,
  p1Deps?: HttpServerP1Deps,
): Promise<Server> {
  const bearerToken = config.mcpHttpBearerToken!;

  const allowedHosts =
    config.mcpAllowedHosts.length > 0 ? config.mcpAllowedHosts : undefined;

  const app = createMcpExpressApp({
    host: config.mcpHttpHost,
    allowedHosts,
  });

  // ── F7: Startup security warning for trusted_user_header mode ─────────────
  if (config.adoAuthMode === 'trusted_user_header') {
    logger.warn(
      {},
      'SECURITY: trusted_user_header mode active. ' +
      'Ensure: (1) service is ClusterIP-only, (2) ingress strips and re-injects ' +
      `"${config.trustedUserHeader}" after authentication, (3) MCP_HTTP_BEARER_TOKEN is ` +
      'not exposed to end users. See docs/deployment-hardening.md.'
    );
  }

  // ── F6: CORS — scoped to MCP HTTP path only, NOT lifecycle routes ─────────
  // Lifecycle routes (/ado/connection/*) are server-side/internal only and must
  // not be callable directly from browsers. CORS is only needed if the MCP client
  // uses browser-based HTTP (uncommon — most MCP clients are server-side).
  if (config.mcpAllowedOrigins.length > 0) {
    const origins = new Set(config.mcpAllowedOrigins);
    app.use(config.mcpHttpPath, (req: Request, res: Response, next: NextFunction) => {
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

  // ── F1/F4/F8: Lifecycle routes — body parser + rate limiter ──────────────
  // - express.json({ limit: '4kb' }) ensures body is parsed and oversized requests
  //   are rejected with 413 before reaching route handlers.
  // - The rate limiter prevents brute-force PAT testing and ADO API abuse.
  //   It is per-IP (per endpoint path) and suitable for single-instance deployment.
  //   For multi-instance, replace with a shared-store rate limiter at ingress level.
  // - A JSON parse error handler returns 400 rather than leaking stack traces.
  //
  // IMPORTANT: Request bodies for /connect and /rotate contain raw PATs.
  //   Never log req.body for these endpoints. The body parser here does not log.
  if (p1Deps?.adoConnectionService) {
    // 10 requests per minute per IP+path — adjustable via env if needed in future
    const lifecycleRateLimiter = new SimpleRateLimiter(10, 60_000);
    lifecycleRateLimiter.startCleanup();

    function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
      const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
      const key = `${ip}:${req.path}`;
      if (!lifecycleRateLimiter.isAllowed(key)) {
        logger.warn({ ip, path: req.path }, 'Lifecycle rate limit exceeded');
        res.status(429).json({ error: 'Too many requests — please wait before retrying' });
        return;
      }
      next();
    }

    // JSON parse error handler for lifecycle routes
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }
      if (status === 413) {
        res.status(413).json({ error: 'Request body too large (max 4kb)' });
        return;
      }
      res.status(400).json({ error: 'Bad request' });
    }

    const connectionRouter = createAdoConnectionRouter(p1Deps.adoConnectionService, config, logger);

    app.use(
      '/ado/connection',
      express.json({ limit: '4kb' }),  // F1: parse JSON body; F4: reject >4kb with 413
      jsonErrorHandler,                 // catch body parse errors before auth/handler
      auth,                             // require bearer token
      rateLimitMiddleware,              // F8: per-IP rate limit
      connectionRouter,
    );

    logger.info({}, 'ADO credential lifecycle routes mounted at /ado/connection/*');
  } else if (config.adoAuthMode === 'trusted_user_header') {
    logger.warn({}, 'trusted_user_header mode active but P1 deps not provided — lifecycle routes not mounted');
  }

  // All MCP routes require bearer auth
  app.use(config.mcpHttpPath, auth);

  async function handleMcp(req: Request, res: Response): Promise<void> {
    // ── P1: trusted_user_header — resolve per-user ADO auth before MCP session ──
    if (config.adoAuthMode === 'trusted_user_header') {
      if (!p1Deps?.userPatResolver) {
        logger.error({}, 'trusted_user_header mode but userPatResolver not wired — rejecting request');
        res.status(503).json({ error: 'Auth service unavailable' });
        return;
      }

      const identityResult = extractTrustedIdentity(req.headers, config.trustedUserHeader, config.trustedUserNameHeader);
      if (!identityResult.ok) {
        logger.warn({ reason: identityResult.reason }, 'Trusted user identity missing from MCP request');
        res.status(401).json({ error: 'Unauthorized', detail: identityResult.reason });
        return;
      }

      const { appUserId } = identityResult.identity;
      const requestId = generateRequestId();

      const resolveResult = await p1Deps.userPatResolver.resolve({
        appUserId,
        adoCollectionKey: config.adoOrgUrl,
        keyB64: config.patEncryptionKeyB64!,
        keyId: config.patEncryptionKeyId,
        requestId,
      });

      if (!resolveResult.ok) {
        logger.warn({ appUserId, requestId, reason: resolveResult.reason }, 'PAT resolution failed for MCP request');
        res.status(resolveResult.httpStatus).json({ error: resolveResult.reason });
        return;
      }

      return requestContextStorage.run(
        { requestId, toolName: '', appUserId, resolvedAuth: resolveResult.auth },
        () => executeMcpRequest(req, res)
      );
    }

    return executeMcpRequest(req, res);
  }

  async function executeMcpRequest(req: Request, res: Response): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const { server } = createConfiguredMcpServer(config, logger, {
      applyMcpoSchemaCompat: false,
      p2: p1Deps?.p2,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
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
