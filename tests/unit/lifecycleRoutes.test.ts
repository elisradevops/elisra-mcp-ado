/**
 * Tests for P1.5 findings in adoConnectionRoutes.ts:
 *
 * F1: express.json() body parser is required
 * F4: body size limit (4kb)
 * F5: adoCollectionKey validated against config.adoOrgUrl
 * + response safety: no rawPat, no encryptedPat, no Authorization
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { createAdoConnectionRouter } from '../../src/lifecycle/adoConnectionRoutes.js';
import type { AdoConnectionService } from '../../src/lifecycle/adoConnectionService.js';
import type { AppConfig } from '../../src/config/config.js';
import { createSilentLogger } from '../../src/logging/logger.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const CONFIG: AppConfig = {
  adoOrgUrl: 'https://tfs.example.local/tfs/DefaultCollection',
  trustedUserHeader: 'x-forwarded-user',
  trustedUserNameHeader: undefined,
  adoAuthMode: 'trusted_user_header',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAllowPatInToolArgs: false,
  adoReadOnly: true,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
  adoPageSizeDefault: 50,
  adoPageSizeMax: 200,
  adoScopeCacheTtlMs: 600000,
  adoScopeCacheMaxEntries: 50,
  adoReviewExtraFields: [],
  adoTraceabilityLinkTokens: [],
  logLevel: 'silent' as unknown as AppConfig['logLevel'],
  mcpoApiKey: undefined,
  adoPat: undefined,
  mcpTransport: 'http',
  mcpHttpHost: '127.0.0.1',
  mcpHttpPort: 3000,
  mcpHttpPath: '/mcp',
  mcpAllowedHosts: [],
  mcpAllowedOrigins: [],
  mcpHttpBearerToken: 'test-bearer',
  mongoUri: 'mongodb://localhost:27017/ado_mcp',
  mongoDbName: 'ado_mcp',
  adoCredentialsCollection: 'ado_user_credentials',
  patEncryptionKeyB64: Buffer.alloc(32, 0x01).toString('base64'),
  patEncryptionKeyId: 'v1',
};

const TRUSTED_HEADER = { 'x-forwarded-user': 'alice@example.com' };

const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyz123456ABCDEFGH';

function makeService(): AdoConnectionService {
  return {
    connect: vi.fn().mockResolvedValue({
      ok: true,
      data: { adoIdentityDisplayName: 'Alice', adoIdentityUniqueName: 'alice@example.com' },
    }),
    test: vi.fn().mockResolvedValue({
      ok: true,
      data: { adoIdentityDisplayName: 'Alice', adoIdentityUniqueName: 'alice@example.com' },
    }),
    rotate: vi.fn().mockResolvedValue({
      ok: true,
      data: { adoIdentityDisplayName: 'Alice', adoIdentityUniqueName: 'alice@example.com' },
    }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
    getStatus: vi.fn().mockResolvedValue({
      ok: true,
      data: { status: { appUserId: 'alice@example.com', status: 'connected', createdAt: new Date(), updatedAt: new Date() } },
    }),
  } as unknown as AdoConnectionService;
}

/**
 * Build a minimal Express app with the lifecycle router mounted.
 * Mirrors the setup in httpServer.ts: json body parser → router.
 */
function buildApp(service: AdoConnectionService): Express {
  const app = express();

  function jsonErrorHandler(err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction): void {
    const status = (err as { status?: number })?.status;
    if (status === 413) {
      res.status(413).json({ error: 'Request body too large (max 4kb)' });
      return;
    }
    res.status(400).json({ error: 'Invalid JSON body' });
  }

  const router = createAdoConnectionRouter(service, CONFIG, createSilentLogger());

  app.use(
    '/ado/connection',
    express.json({ limit: '4kb' }),
    jsonErrorHandler,
    router,
  );

  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lifecycleRoutes — F1: JSON body parsing', () => {
  let service: AdoConnectionService;
  let app: Express;

  beforeEach(() => {
    service = makeService();
    app = buildApp(service);
  });

  it('POST /connect with valid JSON body succeeds', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /connect with no body returns 400, not 500', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .set('Content-Type', 'application/json')
      // no body sent

    // Either 400 (missing rawPat) or 400 (no body) — not 500
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(String(res.body.error)).not.toContain('Cannot read');
  });

  it('POST /connect with missing rawPat returns 400', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ adoCollectionKey: CONFIG.adoOrgUrl });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('rawPat');
  });

  it('POST /connect with invalid JSON body returns 400', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .set('Content-Type', 'application/json')
      .send('not-json{{{');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON');
  });
});

describe('lifecycleRoutes — F4: body size limit', () => {
  let service: AdoConnectionService;
  let app: Express;

  beforeEach(() => {
    service = makeService();
    app = buildApp(service);
  });

  it('POST /connect with body > 4kb returns 413', async () => {
    const largePat = 'x'.repeat(4096 + 100);
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ rawPat: largePat }));

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('POST /connect with body <= 4kb succeeds (if valid PAT)', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    // Should reach the service, not be rejected by body limiter
    expect(res.status).toBe(200);
  });
});

describe('lifecycleRoutes — F5: adoCollectionKey validation', () => {
  let service: AdoConnectionService;
  let app: Express;

  beforeEach(() => {
    service = makeService();
    app = buildApp(service);
  });

  it('connect with matching adoCollectionKey → succeeds', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT, adoCollectionKey: CONFIG.adoOrgUrl });

    expect(res.status).toBe(200);
  });

  it('connect without adoCollectionKey defaults to config.adoOrgUrl', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(res.status).toBe(200);
    // Service should have been called with the config URL
    const callArgs = (service.connect as ReturnType<typeof vi.fn>).mock.calls[0] as [{ adoCollectionKey: string }];
    expect(callArgs[0].adoCollectionKey).toBe(CONFIG.adoOrgUrl);
  });

  it('connect with mismatched adoCollectionKey → 400', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT, adoCollectionKey: 'https://other.example.com/tfs/Coll' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adoCollectionKey/i);
    // Must not expose the configured internal URL in the error
    expect(res.body.error).not.toContain(CONFIG.adoOrgUrl);
  });

  it('status without adoCollectionKey defaults to config', async () => {
    const res = await request(app)
      .get('/ado/connection/status')
      .set(TRUSTED_HEADER);

    expect(res.status).toBe(200);
    const statusArgs = (service.getStatus as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(statusArgs[1]).toBe(CONFIG.adoOrgUrl);
  });

  it('rotate with mismatched adoCollectionKey → 400', async () => {
    const res = await request(app)
      .post('/ado/connection/rotate')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT, adoCollectionKey: 'https://wrong.example.com/tfs/C' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adoCollectionKey/i);
  });
});

describe('lifecycleRoutes — response safety', () => {
  let service: AdoConnectionService;
  let app: Express;

  beforeEach(() => {
    service = makeService();
    app = buildApp(service);
  });

  it('connect response does not contain rawPat', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(JSON.stringify(res.body)).not.toContain(FAKE_PAT);
  });

  it('connect response does not contain encryptedPat field', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(res.body).not.toHaveProperty('encryptedPat');
    expect(JSON.stringify(res.body)).not.toContain('encryptedPat');
  });

  it('connect response does not contain Authorization header', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(res.headers['authorization']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('authorization');
    expect(JSON.stringify(res.body)).not.toContain('Authorization');
  });

  it('connect response contains only safe identity metadata', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set(TRUSTED_HEADER)
      .send({ rawPat: FAKE_PAT });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Only safe fields present
    const allowedKeys = new Set(['ok', 'adoIdentityDisplayName', 'adoIdentityUniqueName']);
    for (const key of Object.keys(res.body)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('status response does not contain encryptedPat', async () => {
    const res = await request(app)
      .get('/ado/connection/status')
      .set(TRUSTED_HEADER);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('encryptedPat');
  });

  it('test response does not contain rawPat or Authorization', async () => {
    const res = await request(app)
      .post('/ado/connection/test')
      .set(TRUSTED_HEADER)
      .send({});

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(res.body)).not.toContain('authorization');
  });

  it('missing trusted header → 401', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .send({ rawPat: FAKE_PAT });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('empty trusted header → 401', async () => {
    const res = await request(app)
      .post('/ado/connection/connect')
      .set('x-forwarded-user', '')
      .send({ rawPat: FAKE_PAT });

    expect(res.status).toBe(401);
  });
});
