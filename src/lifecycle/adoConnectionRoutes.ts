/**
 * HTTP routes for ADO credential lifecycle management.
 *
 * These routes are NOT part of the MCP tool surface — the LLM never sees them.
 * They are intended for a settings/onboarding UI or an admin operator to call directly.
 *
 * Authentication: requires the same bearer token as the MCP routes + trusted user header.
 * The appUserId is extracted from the trusted header — no user-supplied userId.
 *
 * Routes:
 *   POST   /ado/connection/connect      — register or update PAT
 *   GET    /ado/connection/status       — get sanitized credential status
 *   POST   /ado/connection/test         — test current stored PAT
 *   POST   /ado/connection/rotate       — replace PAT
 *   POST   /ado/connection/disconnect   — revoke stored credential
 *
 * SECURITY: Request bodies for /connect and /rotate contain raw ADO PATs.
 *   - Never log req.body for these endpoints.
 *   - The body parser (mounted in httpServer.ts) does not log bodies.
 *   - Ensure log aggregation pipeline excludes body capture for these paths.
 */

import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import type { AdoConnectionService } from './adoConnectionService.js';
import { extractTrustedIdentity } from '../auth/trustedIdentity.js';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import { getRequestContext } from '../utils/requestContext.js';

function requireTrustedUser(
  req: Request,
  res: Response,
  config: AppConfig,
): { appUserId: string } | null {
  const result = extractTrustedIdentity(req.headers, config.trustedUserHeader, config.trustedUserNameHeader);
  if (!result.ok) {
    res.status(401).json({ error: 'Unauthorized', detail: result.reason });
    return null;
  }
  return { appUserId: result.identity.appUserId };
}

/**
 * Resolve and validate adoCollectionKey from the request.
 *
 * F5 fix: The server is configured to manage credentials for a single ADO collection
 * (config.adoOrgUrl). If the client provides a different key, the credential would
 * be stored but unreachable by the resolver (which always uses config.adoOrgUrl).
 *
 * Rules:
 * - If omitted → default to config.adoOrgUrl (safe, expected case)
 * - If provided and matches config.adoOrgUrl → accept
 * - If provided and mismatches → reject with 400
 */
function resolveCollectionKey(
  provided: string | undefined,
  config: AppConfig,
  res: Response,
): string | null {
  if (!provided || provided.trim().length === 0) {
    return config.adoOrgUrl;
  }
  const trimmed = provided.trim();
  if (trimmed !== config.adoOrgUrl) {
    res.status(400).json({
      error: 'adoCollectionKey does not match the configured ADO collection. ' +
        'Omit adoCollectionKey to use the server default.',
    });
    return null;
  }
  return trimmed;
}

function requestId(): string | undefined {
  return getRequestContext()?.requestId;
}

function sanitizeError(error?: string): string {
  return error ?? 'Operation failed';
}

export function createAdoConnectionRouter(
  service: AdoConnectionService,
  config: AppConfig,
  logger: Logger,
): Router {
  const router = createRouter();

  // POST /ado/connection/connect
  router.post('/connect', async (req: Request, res: Response) => {
    const user = requireTrustedUser(req, res, config);
    if (!user) return;

    // F5: Do not log req.body — it contains the raw PAT
    const body = req.body as Record<string, unknown> | undefined;
    const { rawPat, patExpiresAt } = body ?? {};
    const providedKey = typeof (body ?? {})['adoCollectionKey'] === 'string'
      ? (body as Record<string, string>)['adoCollectionKey']
      : undefined;

    if (typeof rawPat !== 'string' || !rawPat.trim()) {
      res.status(400).json({ error: 'rawPat is required' });
      return;
    }

    const adoCollectionKey = resolveCollectionKey(providedKey, config, res);
    if (adoCollectionKey === null) return;

    const expiresAt = patExpiresAt ? new Date(String(patExpiresAt)) : undefined;
    if (expiresAt && isNaN(expiresAt.getTime())) {
      res.status(400).json({ error: 'patExpiresAt must be a valid ISO date' });
      return;
    }

    const result = await service.connect({
      appUserId: user.appUserId,
      adoCollectionKey,
      rawPat,
      patExpiresAt: expiresAt,
    }, requestId());

    if (!result.ok) {
      logger.warn({ appUserId: user.appUserId, route: 'connect', error: sanitizeError(result.error) }, 'connect rejected');
      res.status(400).json({ ok: false, error: sanitizeError(result.error) });
      return;
    }

    res.status(200).json({
      ok: true,
      adoIdentityDisplayName: result.data?.adoIdentityDisplayName,
      adoIdentityUniqueName: result.data?.adoIdentityUniqueName,
    });
  });

  // GET /ado/connection/status
  router.get('/status', async (req: Request, res: Response) => {
    const user = requireTrustedUser(req, res, config);
    if (!user) return;

    const providedKey = typeof req.query['adoCollectionKey'] === 'string'
      ? req.query['adoCollectionKey']
      : undefined;
    const adoCollectionKey = resolveCollectionKey(providedKey, config, res);
    if (adoCollectionKey === null) return;

    const result = await service.getStatus(user.appUserId, adoCollectionKey);
    res.status(200).json({ ok: true, ...result.data });
  });

  // POST /ado/connection/test
  router.post('/test', async (req: Request, res: Response) => {
    const user = requireTrustedUser(req, res, config);
    if (!user) return;

    const body = req.body as Record<string, string> | undefined;
    const providedKey = typeof (body ?? {})['adoCollectionKey'] === 'string'
      ? (body as Record<string, string>)['adoCollectionKey']
      : undefined;
    const adoCollectionKey = resolveCollectionKey(providedKey, config, res);
    if (adoCollectionKey === null) return;

    const result = await service.test(user.appUserId, adoCollectionKey, requestId());

    if (!result.ok) {
      res.status(400).json({ ok: false, error: sanitizeError(result.error) });
      return;
    }
    res.status(200).json({ ok: true, ...result.data });
  });

  // POST /ado/connection/rotate
  router.post('/rotate', async (req: Request, res: Response) => {
    const user = requireTrustedUser(req, res, config);
    if (!user) return;

    // F5: Do not log req.body — it contains the raw PAT
    const body = req.body as Record<string, unknown> | undefined;
    const { rawPat, patExpiresAt } = body ?? {};
    const providedKey = typeof (body ?? {})['adoCollectionKey'] === 'string'
      ? (body as Record<string, string>)['adoCollectionKey']
      : undefined;

    if (typeof rawPat !== 'string' || !rawPat.trim()) {
      res.status(400).json({ error: 'rawPat is required' });
      return;
    }

    const adoCollectionKey = resolveCollectionKey(providedKey, config, res);
    if (adoCollectionKey === null) return;

    const expiresAt = patExpiresAt ? new Date(String(patExpiresAt)) : undefined;
    const result = await service.rotate({
      appUserId: user.appUserId,
      adoCollectionKey,
      rawPat,
      patExpiresAt: expiresAt,
    }, requestId());

    if (!result.ok) {
      res.status(400).json({ ok: false, error: sanitizeError(result.error) });
      return;
    }
    res.status(200).json({ ok: true, ...result.data });
  });

  // POST /ado/connection/disconnect
  router.post('/disconnect', async (req: Request, res: Response) => {
    const user = requireTrustedUser(req, res, config);
    if (!user) return;

    const body = req.body as Record<string, string> | undefined;
    const providedKey = typeof (body ?? {})['adoCollectionKey'] === 'string'
      ? (body as Record<string, string>)['adoCollectionKey']
      : undefined;
    const adoCollectionKey = resolveCollectionKey(providedKey, config, res);
    if (adoCollectionKey === null) return;

    const result = await service.disconnect(user.appUserId, adoCollectionKey, requestId());
    if (!result.ok) {
      res.status(404).json({ ok: false, error: sanitizeError(result.error) });
      return;
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
