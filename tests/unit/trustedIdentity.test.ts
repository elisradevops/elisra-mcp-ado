import { describe, it, expect } from 'vitest';
import { extractTrustedIdentity } from '../../src/auth/trustedIdentity.js';

describe('extractTrustedIdentity', () => {
  const HEADER = 'x-forwarded-user';

  it('returns ok:true with appUserId when header is present', () => {
    const result = extractTrustedIdentity({ [HEADER]: 'user@example.com' }, HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.appUserId).toBe('user@example.com');
  });

  it('trims whitespace from user ID', () => {
    const result = extractTrustedIdentity({ [HEADER]: '  alice  ' }, HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.appUserId).toBe('alice');
  });

  it('returns ok:false when header is missing', () => {
    const result = extractTrustedIdentity({}, HEADER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(HEADER);
  });

  it('returns ok:false when header is empty string', () => {
    const result = extractTrustedIdentity({ [HEADER]: '' }, HEADER);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false when header is whitespace only', () => {
    const result = extractTrustedIdentity({ [HEADER]: '   ' }, HEADER);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false when user ID exceeds 256 chars', () => {
    const result = extractTrustedIdentity({ [HEADER]: 'a'.repeat(257) }, HEADER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('maximum length');
  });

  it('accepts exactly 256 chars', () => {
    const result = extractTrustedIdentity({ [HEADER]: 'a'.repeat(256) }, HEADER);
    expect(result.ok).toBe(true);
  });

  it('rejects user ID with control characters', () => {
    const result = extractTrustedIdentity({ [HEADER]: 'user\x00id' }, HEADER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('invalid characters');
  });

  it('handles array header value (takes first)', () => {
    const result = extractTrustedIdentity({ [HEADER]: ['first@example.com', 'second@example.com'] }, HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.appUserId).toBe('first@example.com');
  });

  it('extracts displayName from optional name header', () => {
    const NAME_HEADER = 'x-forwarded-name';
    const result = extractTrustedIdentity(
      { [HEADER]: 'user@example.com', [NAME_HEADER]: 'Alice Smith' },
      HEADER,
      NAME_HEADER,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.displayName).toBe('Alice Smith');
  });

  it('displayName is undefined when name header absent', () => {
    const result = extractTrustedIdentity({ [HEADER]: 'user@example.com' }, HEADER, 'x-name');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.displayName).toBeUndefined();
  });

  it('works with typical Open WebUI user IDs (email format)', () => {
    const userId = 'john.doe@company.internal';
    const result = extractTrustedIdentity({ [HEADER]: userId }, HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.appUserId).toBe(userId);
  });
});
