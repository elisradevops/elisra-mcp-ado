import { describe, it, expect } from 'vitest';
import { redactString, redactDeep, REDACTED, PAT_REDACTED } from '../../src/security/secretRedaction.js';
import { redactError } from '../../src/auth/redact.js';

// Typical 52-char alphanumeric ADO PAT shape
const FAKE_PAT = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FAKE_PAT_B64 = Buffer.from(`:${FAKE_PAT}`).toString('base64');

describe('redactString', () => {
  it('replaces PAT-shaped strings', () => {
    const result = redactString(FAKE_PAT);
    expect(result).toBe(PAT_REDACTED);
    expect(result).not.toContain(FAKE_PAT);
  });

  it('replaces PAT inside a larger string', () => {
    const input = `Authorization: Basic ${FAKE_PAT_B64}`;
    const result = redactString(input);
    expect(result).not.toContain(FAKE_PAT);
    expect(result).toContain(PAT_REDACTED);
  });

  it('leaves short strings alone', () => {
    expect(redactString('hello')).toBe('hello');
    expect(redactString('shortpat123')).toBe('shortpat123');
  });

  it('handles empty string', () => {
    expect(redactString('')).toBe('');
  });
});

describe('redactDeep', () => {
  it('redacts sensitive keys in objects', () => {
    const obj = { pat: FAKE_PAT, url: 'https://tfs.example.com', other: 'ok' };
    const result = redactDeep(obj);
    expect(result.pat).toBe(REDACTED);
    expect(result.url).toBe('https://tfs.example.com');
    expect(result.other).toBe('ok');
  });

  it('redacts nested sensitive keys', () => {
    const obj = { config: { authorization: 'Basic abc', auth: { password: 'secret' } } };
    const result = redactDeep(obj);
    expect(result.config.authorization).toBe(REDACTED);
    expect(result.config.auth.password).toBe(REDACTED);
  });

  it('redacts PAT-shaped strings in non-sensitive keys', () => {
    const obj = { message: `error: token=${FAKE_PAT}` };
    const result = redactDeep(obj);
    expect(result.message).not.toContain(FAKE_PAT);
  });

  it('handles arrays', () => {
    const arr = [{ pat: FAKE_PAT }, { name: 'ok' }];
    const result = redactDeep(arr);
    expect(result[0]?.pat).toBe(REDACTED);
    expect(result[1]?.name).toBe('ok');
  });

  it('handles null and primitives', () => {
    expect(redactDeep(null)).toBe(null);
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep(true)).toBe(true);
  });

  it('does not mutate the original object', () => {
    const obj = { pat: FAKE_PAT };
    const original = { ...obj };
    redactDeep(obj);
    expect(obj.pat).toBe(original.pat);
  });
});

describe('redactError', () => {
  it('redacts PAT from error message', () => {
    const err = new Error(`request failed with pat=${FAKE_PAT}`);
    const safe = redactError(err);
    expect(safe.message).not.toContain(FAKE_PAT);
    expect(safe.message).toContain(PAT_REDACTED);
  });

  it('strips axios config.headers from error', () => {
    const err = new Error('axios error') as Error & Record<string, unknown>;
    err['config'] = { headers: { Authorization: `Basic ${FAKE_PAT_B64}` }, url: 'https://tfs.example.com' };
    const safe = redactError(err) as Error & Record<string, unknown>;
    const cfg = safe['config'] as Record<string, unknown>;
    expect(cfg?.['headers']).toBe(REDACTED);
  });

  it('redacts PAT-shaped string from error stack', () => {
    const err = new Error('fail');
    err.stack = `Error: fail\n    at callSite (https://tfs/path?token=${FAKE_PAT}:1:1)`;
    const safe = redactError(err) as Error;
    expect(safe.stack).not.toContain(FAKE_PAT);
  });

  it('handles non-Error input', () => {
    const safe = redactError('plain string error');
    expect(safe).toBeInstanceOf(Error);
  });

  it('handles undefined', () => {
    const safe = redactError(undefined);
    expect(safe).toBeInstanceOf(Error);
  });
});
