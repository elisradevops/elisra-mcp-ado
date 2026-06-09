import { describe, it, expect } from 'vitest';
import { encryptPat, decryptPat, decryptPatAsString } from '../../src/crypto/patEncryption.js';

// 32-byte key for testing — generated fresh, not a production key
const TEST_KEY_B64 = Buffer.from('0'.repeat(32), 'utf8').toString('base64');
const TEST_KEY_ID = 'v1';
const SAMPLE_PAT = 'abcdefghijklmnopqrstuvwxyz123456ABCDEFGH';

describe('patEncryption — encrypt/decrypt roundtrip', () => {
  it('encrypts and decrypts a PAT correctly', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const result = decryptPatAsString(envelope, TEST_KEY_B64, TEST_KEY_ID);
    expect(result).toBe(SAMPLE_PAT);
  });

  it('decryptPat returns Buffer', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const buf = decryptPat(envelope, TEST_KEY_B64, TEST_KEY_ID);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe(SAMPLE_PAT);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const b = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('stores keyId and algorithm on envelope', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(envelope.keyId).toBe(TEST_KEY_ID);
    expect(envelope.algorithm).toBe('aes-256-gcm');
  });

  it('ciphertext does not contain raw PAT', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(envelope.ciphertext).not.toContain(SAMPLE_PAT);
    expect(JSON.stringify(envelope)).not.toContain(SAMPLE_PAT);
  });

  it('IV is 24 hex chars (96-bit)', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(envelope.iv).toHaveLength(24);
  });

  it('authTag is 32 hex chars (128-bit)', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(envelope.authTag).toHaveLength(32);
  });
});

describe('patEncryption — failure cases', () => {
  it('rejects empty PAT', () => {
    expect(() => encryptPat('', TEST_KEY_B64, TEST_KEY_ID)).toThrow('not be empty');
  });

  it('rejects whitespace-only PAT', () => {
    expect(() => encryptPat('   ', TEST_KEY_B64, TEST_KEY_ID)).toThrow('not be empty');
  });

  it('throws on wrong key (key size mismatch)', () => {
    const shortKey = Buffer.from('short').toString('base64');
    expect(() => encryptPat(SAMPLE_PAT, shortKey, TEST_KEY_ID)).toThrow('32 bytes');
  });

  it('throws on modified ciphertext (GCM authentication failure)', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const tampered = { ...envelope, ciphertext: 'ff'.repeat(envelope.ciphertext.length / 2) };
    expect(() => decryptPat(tampered, TEST_KEY_B64, TEST_KEY_ID)).toThrow();
  });

  it('throws on modified authTag', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const tampered = { ...envelope, authTag: '00'.repeat(16) };
    expect(() => decryptPat(tampered, TEST_KEY_B64, TEST_KEY_ID)).toThrow();
  });

  it('throws on wrong keyId', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    expect(() => decryptPat(envelope, TEST_KEY_B64, 'v2')).toThrow('keyId');
  });

  it('throws on unsupported algorithm', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const bad = { ...envelope, algorithm: 'aes-128-cbc' as 'aes-256-gcm' };
    expect(() => decryptPat(bad, TEST_KEY_B64, TEST_KEY_ID)).toThrow('algorithm');
  });

  it('different key fails decryption', () => {
    const envelope = encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID);
    const otherKey = Buffer.from('1'.repeat(32), 'utf8').toString('base64');
    expect(() => decryptPat(envelope, otherKey, TEST_KEY_ID)).toThrow();
  });
});
