/**
 * Verifies point 5: requestId set by wrapTool flows through AsyncLocalStorage
 * into ADO client log entries (adoClient.ts calls logger.warn inside the
 * same async context created by wrapTool).
 */
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import winston from 'winston';
import { Writable } from 'node:stream';
import { AdoClient } from '../../src/ado/adoClient.js';
import { requestContextStorage } from '../../src/utils/requestContext.js';
import { generateRequestId } from '../../src/utils/requestId.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';
import type { Logger } from '../../src/logging/logger.js';

const LOG_LEVELS = { fatal: 0, error: 1, warn: 2, info: 3, debug: 6, trace: 7 };

const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AUTH: AuthContext = { mode: 'server_pat', pat: FAKE_PAT, source: 'server_env' };

const baseConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAuthMode: 'server_pat',
  adoReadOnly: true,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
} as unknown as AppConfig;

/**
 * Build a logger that captures structured log entries into an array.
 * Applies the same requestContextFormat as the real logger so we can verify
 * that requestId from AsyncLocalStorage is injected into each entry.
 */
function makeCaptureLogger(): { logger: Logger; entries: Record<string, unknown>[] } {
  const entries: Record<string, unknown>[] = [];

  // Replicate the requestContextFormat from src/logging/logger.ts
  const requestContextFormat = winston.format((info) => {
    const ctx = requestContextStorage.getStore();
    if (ctx) {
      const r = info as Record<string, unknown>;
      if (!r['requestId']) r['requestId'] = ctx.requestId;
      if (!r['toolName']) r['toolName'] = ctx.toolName;
    }
    return info;
  });

  const captureStream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      try { entries.push(JSON.parse(chunk.toString()) as Record<string, unknown>); } catch { /* ignore */ }
      cb();
    },
  });

  const captureTransport = new winston.transports.Stream({ stream: captureStream });

  const inner = winston.createLogger({
    levels: LOG_LEVELS,
    level: 'warn',
    format: winston.format.combine(requestContextFormat(), winston.format.json()),
    transports: [captureTransport],
  });

  const logger = inner as unknown as Logger;
  (logger as Record<string, unknown>)['child'] = (_b: unknown) => logger;
  return { logger, entries };
}

describe('requestId propagates into AdoClient logs via AsyncLocalStorage', () => {
  it('warn log from ADO 401 carries requestId from wrapTool context', async () => {
    const axiosInst = axios.create({ validateStatus: null });
    const mock = new MockAdapter(axiosInst);
    mock.onGet('https://tfs.example.com/endpoint').reply(401, { message: 'Unauthorized' });

    const { logger, entries } = makeCaptureLogger();
    const client = new AdoClient(baseConfig, logger, axiosInst);
    const requestId = generateRequestId();

    await requestContextStorage.run({ requestId, toolName: 'test_tool' }, async () => {
      await expect(
        client.get('https://tfs.example.com/endpoint', AUTH)
      ).rejects.toThrow();
    });

    mock.restore();

    // At least one warn entry should have been emitted (ADO 401 path)
    expect(entries.length).toBeGreaterThan(0);
    // Every captured entry should carry the requestId from context
    for (const entry of entries) {
      expect(entry['requestId']).toBe(requestId);
    }
  });

  it('warn log from ADO 500 retry carries requestId', async () => {
    const axiosInst = axios.create({ validateStatus: null });
    const mock = new MockAdapter(axiosInst);
    let calls = 0;
    mock.onGet('https://tfs.example.com/flaky').reply(() => {
      calls++;
      return calls < 3 ? [500, {}] : [200, { ok: true }];
    });

    const { logger, entries } = makeCaptureLogger();
    const client = new AdoClient(baseConfig, logger, axiosInst);
    const requestId = generateRequestId();

    await requestContextStorage.run({ requestId, toolName: 'test_tool' }, async () => {
      await client.get('https://tfs.example.com/flaky', AUTH);
    });

    mock.restore();

    // Retry path emits warn entries
    const warnEntries = entries.filter((e) => e['level'] === 'warn');
    expect(warnEntries.length).toBeGreaterThan(0);
    for (const entry of warnEntries) {
      expect(entry['requestId']).toBe(requestId);
    }
  });

  it('requestId is absent when log is emitted outside any context', async () => {
    const axiosInst = axios.create({ validateStatus: null });
    const mock = new MockAdapter(axiosInst);
    mock.onGet('https://tfs.example.com/endpoint').reply(401, {});

    const { logger, entries } = makeCaptureLogger();
    const client = new AdoClient(baseConfig, logger, axiosInst);

    // Deliberately NOT wrapping in requestContextStorage.run()
    await expect(client.get('https://tfs.example.com/endpoint', AUTH)).rejects.toThrow();

    mock.restore();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // No context → requestId should not appear
      expect(entry['requestId']).toBeUndefined();
    }
  });
});
