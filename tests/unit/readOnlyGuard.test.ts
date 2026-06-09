import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { AdoClient } from '../../src/ado/adoClient.js';
import { createSilentLogger } from '../../src/logging/logger.js';
import type { AppConfig } from '../../src/config/config.js';
import type { AuthContext } from '../../src/auth/authContext.js';

const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AUTH: AuthContext = { mode: 'server_pat', pat: FAKE_PAT, source: 'server_env' };

const readOnlyConfig: AppConfig = {
  adoOrgUrl: 'https://tfs.example.com/tfs/DefaultCollection',
  adoApiVersion: '7.0',
  adoBatchSize: 200,
  adoAuthMode: 'server_pat',
  adoAllowPatInToolArgs: false,
  adoReadOnly: true,
  adoEnableDebugOutput: false,
  adoRequestTimeoutMs: 5000,
  adoAllowUnknownFields: false,
  adoPageSizeDefault: 50,
  adoPageSizeMax: 200,
  adoScopeCacheTtlMs: 600000,
  adoScopeCacheMaxEntries: 50,
  logLevel: 'silent' as unknown as AppConfig['logLevel'],
  mcpoApiKey: undefined,
  adoPat: FAKE_PAT,
} as unknown as AppConfig; // cast: tests only need fields AdoClient actually uses

const readWriteConfig: AppConfig = {
  ...readOnlyConfig,
  adoReadOnly: false,
} as unknown as AppConfig;

describe('AdoClient — ADO_READ_ONLY guard', () => {
  let mock: MockAdapter;
  let axiosInst: ReturnType<typeof axios.create>;

  beforeEach(() => {
    axiosInst = axios.create({ validateStatus: null });
    mock = new MockAdapter(axiosInst);
  });

  afterEach(() => {
    mock.restore();
  });

  // ── blocked when adoReadOnly=true ─────────────────────────────────────────

  it('blocks POST when adoReadOnly=true', async () => {
    mock.onPost('https://tfs.example.com/endpoint').reply(200, {});
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    await expect(
      client.request({ method: 'POST', url: 'https://tfs.example.com/endpoint', auth: AUTH })
    ).rejects.toThrow('ADO_READ_ONLY=true');
  });

  it('blocks PATCH when adoReadOnly=true', async () => {
    mock.onPatch('https://tfs.example.com/endpoint').reply(200, {});
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    await expect(
      client.request({ method: 'PATCH', url: 'https://tfs.example.com/endpoint', auth: AUTH })
    ).rejects.toThrow('ADO_READ_ONLY=true');
  });

  it('blocks PUT when adoReadOnly=true', async () => {
    mock.onPut('https://tfs.example.com/endpoint').reply(200, {});
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    await expect(
      client.request({ method: 'PUT', url: 'https://tfs.example.com/endpoint', auth: AUTH })
    ).rejects.toThrow('ADO_READ_ONLY=true');
  });

  it('blocks DELETE when adoReadOnly=true', async () => {
    mock.onDelete('https://tfs.example.com/endpoint').reply(200, {});
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    await expect(
      client.request({ method: 'DELETE', url: 'https://tfs.example.com/endpoint', auth: AUTH })
    ).rejects.toThrow('ADO_READ_ONLY=true');
  });

  it('guard fires before HTTP — no outbound request made', async () => {
    let called = false;
    mock.onPost('https://tfs.example.com/endpoint').reply(() => {
      called = true;
      return [200, {}];
    });
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    await expect(
      client.request({ method: 'POST', url: 'https://tfs.example.com/endpoint', auth: AUTH })
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  // ── allowed when adoReadOnly=true ─────────────────────────────────────────

  it('allows GET when adoReadOnly=true', async () => {
    mock.onGet('https://tfs.example.com/endpoint').reply(200, { ok: true });
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    const result = await client.get<{ ok: boolean }>('https://tfs.example.com/endpoint', AUTH);
    expect(result.ok).toBe(true);
  });

  // ── allowed when adoReadOnly=false ────────────────────────────────────────

  it('allows POST when adoReadOnly=false', async () => {
    mock.onPost('https://tfs.example.com/endpoint').reply(200, { created: true });
    const client = new AdoClient(readWriteConfig, createSilentLogger(), axiosInst);
    const result = await client.request<{ created: boolean }>({
      method: 'POST',
      url: 'https://tfs.example.com/endpoint',
      auth: AUTH,
      data: { title: 'test' },
    });
    expect(result.created).toBe(true);
  });

  it('allows PATCH when adoReadOnly=false', async () => {
    mock.onPatch('https://tfs.example.com/endpoint').reply(200, { updated: true });
    const client = new AdoClient(readWriteConfig, createSilentLogger(), axiosInst);
    const result = await client.request<{ updated: boolean }>({
      method: 'PATCH',
      url: 'https://tfs.example.com/endpoint',
      auth: AUTH,
      data: [{ op: 'replace', path: '/fields/System.Title', value: 'New Title' }],
    });
    expect(result.updated).toBe(true);
  });

  // ── error message safety ───────────────────────────────────────────────────

  it('read-only error does not contain the PAT', async () => {
    const client = new AdoClient(readOnlyConfig, createSilentLogger(), axiosInst);
    try {
      await client.request({ method: 'POST', url: 'https://tfs.example.com/endpoint', auth: AUTH });
      expect.fail('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(FAKE_PAT);
    }
  });
});
