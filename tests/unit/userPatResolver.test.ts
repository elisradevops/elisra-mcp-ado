import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserPatResolver } from '../../src/credentials/userPatResolver.js';
import type { AdoCredentialRepository, AdoCredentialDocument } from '../../src/credentials/adoCredentialRepository.js';
import { encryptPat } from '../../src/crypto/patEncryption.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const TEST_KEY_B64 = Buffer.from('t'.repeat(32), 'utf8').toString('base64');
const TEST_KEY_ID = 'v1';
const SAMPLE_PAT = 'abcdefghijklmnopqrstuvwxyz123456ABCDEFGH';

function makeRepo(): AdoCredentialRepository {
  return {
    findForAuth: vi.fn(),
    findStatus: vi.fn(),
    upsertCredential: vi.fn(),
    revokeCredential: vi.fn(),
    markInvalid: vi.fn().mockImplementation(() => Promise.resolve()),
    touchLastUsed: vi.fn().mockImplementation(() => Promise.resolve()),
    deleteCredential: vi.fn(),
    ensureIndexes: vi.fn(),
  } as unknown as AdoCredentialRepository;
}

function makeConnectedDoc(): AdoCredentialDocument {
  return {
    appUserId: 'alice@example.com',
    adoCollectionKey: 'https://tfs.example.local/tfs/DefaultCollection',
    adoIdentityDisplayName: 'Alice Smith',
    adoIdentityUniqueName: 'alice@example.com',
    encryptedPat: encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID),
    status: 'connected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('UserPatResolver', () => {
  let repo: AdoCredentialRepository;
  let resolver: UserPatResolver;
  const logger = createSilentLogger();

  beforeEach(() => {
    repo = makeRepo();
    resolver = new UserPatResolver(repo, logger);
  });

  const OPTS = {
    appUserId: 'alice@example.com',
    adoCollectionKey: 'https://tfs.example.local/tfs/DefaultCollection',
    keyB64: TEST_KEY_B64,
    keyId: TEST_KEY_ID,
  };

  it('resolves successfully for a connected credential', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(makeConnectedDoc());
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.mode).toBe('trusted_user_header');
      expect(result.auth.appUserId).toBe('alice@example.com');
      expect(result.auth.source).toBe('trusted_header');
      expect(typeof result.auth.pat).toBe('string');
      expect(result.auth.pat).toBe(SAMPLE_PAT);
    }
  });

  it('updates lastUsedAt on success', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(makeConnectedDoc());
    await resolver.resolve(OPTS);
    // touchLastUsed is called non-critically — just verify it was called
    expect(repo.touchLastUsed).toHaveBeenCalledWith('alice@example.com', OPTS.adoCollectionKey);
  });

  it('returns 404 when no credential found', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(null);
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(404);
      expect(result.reason).toMatch(/no.*credential/i);
    }
  });

  it('returns 403 for revoked credential', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue({ ...makeConnectedDoc(), status: 'revoked' });
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(403);
  });

  it('returns 403 for invalid credential', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue({ ...makeConnectedDoc(), status: 'invalid' });
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(403);
  });

  it('returns 401 for expired credential', async () => {
    const doc = { ...makeConnectedDoc(), patExpiresAt: new Date(Date.now() - 1000) };
    vi.mocked(repo.findForAuth).mockResolvedValue(doc);
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(401);
  });

  it('marks credential invalid when PAT is expired', async () => {
    const doc = { ...makeConnectedDoc(), patExpiresAt: new Date(Date.now() - 1000) };
    vi.mocked(repo.findForAuth).mockResolvedValue(doc);
    vi.mocked(repo.markInvalid).mockResolvedValue(undefined);
    await resolver.resolve(OPTS);
    expect(repo.markInvalid).toHaveBeenCalled();
  });

  it('returns 500 when DB lookup throws', async () => {
    vi.mocked(repo.findForAuth).mockRejectedValue(new Error('MongoDB connection lost'));
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(500);
  });

  it('does not expose PAT in failure result', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(null);
    const result = await resolver.resolve(OPTS);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_PAT);
  });

  it('does not expose PAT in success result outside of auth.pat field', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(makeConnectedDoc());
    const result = await resolver.resolve(OPTS);
    // The result object should contain auth.pat but nowhere else
    if (result.ok) {
      const resultStr = JSON.stringify(result);
      // Count occurrences — should appear only once (in auth.pat)
      const occurrences = (resultStr.match(new RegExp(SAMPLE_PAT, 'g')) ?? []).length;
      expect(occurrences).toBe(1);
    }
  });

  it('resolves future expiry as valid', async () => {
    const doc = { ...makeConnectedDoc(), patExpiresAt: new Date(Date.now() + 86400000) };
    vi.mocked(repo.findForAuth).mockResolvedValue(doc);
    const result = await resolver.resolve(OPTS);
    expect(result.ok).toBe(true);
  });
});
