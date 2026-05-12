import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { AdoClient } from '../../src/ado/adoClient.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AUTH: AuthContext = { mode: 'per_request_pat', pat: FAKE_PAT };

const baseConfig: AppConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAuthMode: 'per_request_pat',
  adoReadOnly: true,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
  adoFullResponseMaxItems: 50,
  logLevel: 'silent' as unknown as AppConfig['logLevel'],
  mcpoApiKey: undefined,
  adoPat: undefined,
};

function makeClient(axiosMock: ReturnType<typeof axios.create>) {
  return new AdoClient(baseConfig, createSilentLogger(), axiosMock);
}

describe('AdoClient', () => {
  let mock: MockAdapter;
  let axiosInst: ReturnType<typeof axios.create>;

  beforeEach(() => {
    axiosInst = axios.create({ validateStatus: null });
    mock = new MockAdapter(axiosInst);
  });

  afterEach(() => {
    mock.restore();
  });

  it('returns data on 200', async () => {
    mock.onGet('https://tfs.example.com/endpoint').reply(200, { ok: true });
    const client = makeClient(axiosInst);
    const result = await client.get<{ ok: boolean }>(
      'https://tfs.example.com/endpoint',
      AUTH
    );
    expect(result.ok).toBe(true);
  });

  it('includes Authorization header', async () => {
    mock.onGet('https://tfs.example.com/endpoint').reply((config) => {
      const auth = config.headers?.['Authorization'] ?? config.headers?.['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Basic ')) {
        return [200, { authorized: true }];
      }
      return [401, {}];
    });
    const client = makeClient(axiosInst);
    const result = await client.get<{ authorized: boolean }>('https://tfs.example.com/endpoint', AUTH);
    expect(result.authorized).toBe(true);
  });

  it('does not retry on 401', async () => {
    let callCount = 0;
    mock.onGet('https://tfs.example.com/secure').reply(() => {
      callCount++;
      return [401, { message: 'Unauthorized' }];
    });
    const client = makeClient(axiosInst);
    await expect(client.get('https://tfs.example.com/secure', AUTH)).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('does not retry on 403', async () => {
    let callCount = 0;
    mock.onGet('https://tfs.example.com/forbidden').reply(() => {
      callCount++;
      return [403, { message: 'Forbidden' }];
    });
    const client = makeClient(axiosInst);
    await expect(client.get('https://tfs.example.com/forbidden', AUTH)).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('retries on 500 up to RETRY_MAX attempts', async () => {
    let callCount = 0;
    mock.onGet('https://tfs.example.com/flaky').reply(() => {
      callCount++;
      if (callCount < 3) return [500, {}];
      return [200, { recovered: true }];
    });
    const client = makeClient(axiosInst);
    const result = await client.get<{ recovered: boolean }>('https://tfs.example.com/flaky', AUTH);
    expect(result.recovered).toBe(true);
    expect(callCount).toBe(3);
  });

  it('throws after all retries exhausted on 500', async () => {
    mock.onGet('https://tfs.example.com/always500').reply(500, {});
    const client = makeClient(axiosInst);
    await expect(client.get('https://tfs.example.com/always500', AUTH)).rejects.toThrow();
  });

  it('retries on 429 (rate limit)', async () => {
    let callCount = 0;
    mock.onGet('https://tfs.example.com/ratelimited').reply(() => {
      callCount++;
      if (callCount < 2) return [429, {}];
      return [200, { ok: true }];
    });
    const client = makeClient(axiosInst);
    const result = await client.get<{ ok: boolean }>('https://tfs.example.com/ratelimited', AUTH);
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });

  it('does not expose PAT in thrown error message', async () => {
    mock.onGet('https://tfs.example.com/err').reply(401, {});
    const client = makeClient(axiosInst);
    try {
      await client.get('https://tfs.example.com/err', AUTH);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(FAKE_PAT);
    }
  });

  it('buildUrl joins segments with the base URL', () => {
    const client = makeClient(axiosInst);
    const url = client.buildUrl('_apis', 'projects');
    expect(url).toBe('https://tfs.example.com/tfs/DefaultCollection/_apis/projects');
  });
});
