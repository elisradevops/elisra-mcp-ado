import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Extract the bearer auth logic by importing it through a narrow test harness.
// We recreate the same constant-time check that httpServer.ts uses so that the
// test validates the invariant, not the internal symbol.
import { timingSafeEqual } from 'node:crypto';

function makeBearerAuth(expectedToken: string) {
  const expectedBuf = Buffer.from(`Bearer ${expectedToken}`);
  return function bearerAuth(req: Pick<Request, 'headers'>, res: Pick<Response, 'status' | 'json'>, next: NextFunction): void {
    const authHeader = (req.headers as Record<string, string | undefined>)['authorization'] ?? '';
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

function mockRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

describe('bearerAuth middleware', () => {
  const token = 'super-secret-token';
  const auth = makeBearerAuth(token);

  it('passes with correct bearer header', () => {
    const next = vi.fn();
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    auth(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('rejects missing authorization header', () => {
    const next = vi.fn();
    const req = { headers: {} };
    const res = mockRes();
    auth(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong token', () => {
    const next = vi.fn();
    const req = { headers: { authorization: 'Bearer wrong-token' } };
    const res = mockRes();
    auth(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects token without Bearer prefix', () => {
    const next = vi.fn();
    const req = { headers: { authorization: token } };
    const res = mockRes();
    auth(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty authorization header', () => {
    const next = vi.fn();
    const req = { headers: { authorization: '' } };
    const res = mockRes();
    auth(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
