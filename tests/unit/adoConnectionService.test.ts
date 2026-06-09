import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoConnectionService } from '../../src/lifecycle/adoConnectionService.js';
import type { AdoCredentialRepository } from '../../src/credentials/adoCredentialRepository.js';
import type { ProjectsClient } from '../../src/ado/projectsClient.js';
import { encryptPat } from '../../src/crypto/patEncryption.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const TEST_KEY_B64 = Buffer.from('s'.repeat(32), 'utf8').toString('base64');
const TEST_KEY_ID = 'v1';
const SAMPLE_PAT = 'abcdefghijklmnopqrstuvwxyz123456ABCDEFGH';
const COLLECTION_KEY = 'https://tfs.example.local/tfs/DefaultCollection';

function makeRepo(): AdoCredentialRepository {
  return {
    upsertCredential: vi.fn().mockResolvedValue(undefined),
    findForAuth: vi.fn(),
    findStatus: vi.fn(),
    revokeCredential: vi.fn().mockResolvedValue(true),
    markInvalid: vi.fn().mockResolvedValue(undefined),
    touchLastUsed: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn(),
    ensureIndexes: vi.fn(),
  } as unknown as AdoCredentialRepository;
}

function makeProjectsClient(success = true): ProjectsClient {
  return {
    getConnectionData: vi.fn().mockResolvedValue(
      success
        ? { authenticatedUser: { providerDisplayName: 'Alice', subjectDescriptor: 'alice@example.com', id: 'abc' } }
        : (() => { throw new Error('Unauthorized'); })()
    ),
  } as unknown as ProjectsClient;
}

describe('AdoConnectionService — connect', () => {
  let repo: ReturnType<typeof makeRepo>;
  let projectsClient: ReturnType<typeof makeProjectsClient>;
  let service: AdoConnectionService;
  const logger = createSilentLogger();

  beforeEach(() => {
    repo = makeRepo();
    projectsClient = makeProjectsClient(true);
    service = new AdoConnectionService(repo, projectsClient, TEST_KEY_B64, TEST_KEY_ID, logger);
  });

  it('connects successfully and returns identity metadata', async () => {
    const result = await service.connect({ appUserId: 'alice', adoCollectionKey: COLLECTION_KEY, rawPat: SAMPLE_PAT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.adoIdentityDisplayName).toBe('Alice');
      expect(result.data?.adoIdentityUniqueName).toBe('alice@example.com');
    }
  });

  it('does NOT return the raw PAT in connect result', async () => {
    const result = await service.connect({ appUserId: 'alice', adoCollectionKey: COLLECTION_KEY, rawPat: SAMPLE_PAT });
    expect(JSON.stringify(result)).not.toContain(SAMPLE_PAT);
  });

  it('stores encrypted PAT (not raw) via repo.upsertCredential', async () => {
    await service.connect({ appUserId: 'alice', adoCollectionKey: COLLECTION_KEY, rawPat: SAMPLE_PAT });
    const callArgs = (repo.upsertCredential as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const encryptedPat = callArgs[2] as { algorithm: string; ciphertext: string };
    // Encrypted envelope stored, not raw PAT
    expect(encryptedPat.algorithm).toBe('aes-256-gcm');
    expect(JSON.stringify(encryptedPat)).not.toContain(SAMPLE_PAT);
  });

  it('rejects empty PAT', async () => {
    const result = await service.connect({ appUserId: 'alice', adoCollectionKey: COLLECTION_KEY, rawPat: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it('returns error when ADO validation fails', async () => {
    const failClient = {
      getConnectionData: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    } as unknown as ProjectsClient;
    const svc = new AdoConnectionService(repo, failClient, TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await svc.connect({ appUserId: 'alice', adoCollectionKey: COLLECTION_KEY, rawPat: SAMPLE_PAT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/PAT validation failed/i);
  });
});

describe('AdoConnectionService — test', () => {
  let repo: ReturnType<typeof makeRepo>;
  const logger = createSilentLogger();

  beforeEach(() => {
    repo = makeRepo();
  });

  it('returns error when no credential found', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue(null);
    const service = new AdoConnectionService(repo, makeProjectsClient(true), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.test('alice', COLLECTION_KEY);
    expect(result.ok).toBe(false);
  });

  it('returns identity when PAT is valid', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue({
      appUserId: 'alice',
      adoCollectionKey: COLLECTION_KEY,
      encryptedPat: encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID),
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new AdoConnectionService(repo, makeProjectsClient(true), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.test('alice', COLLECTION_KEY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.adoIdentityDisplayName).toBe('Alice');
  });

  it('does not return raw PAT in test result', async () => {
    vi.mocked(repo.findForAuth).mockResolvedValue({
      appUserId: 'alice',
      adoCollectionKey: COLLECTION_KEY,
      encryptedPat: encryptPat(SAMPLE_PAT, TEST_KEY_B64, TEST_KEY_ID),
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new AdoConnectionService(repo, makeProjectsClient(true), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.test('alice', COLLECTION_KEY);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_PAT);
  });
});

describe('AdoConnectionService — disconnect', () => {
  const logger = createSilentLogger();

  it('disconnects successfully', async () => {
    const repo = makeRepo();
    vi.mocked(repo.revokeCredential).mockResolvedValue(true);
    const service = new AdoConnectionService(repo, makeProjectsClient(), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.disconnect('alice', COLLECTION_KEY);
    expect(result.ok).toBe(true);
  });

  it('returns error when no credential found', async () => {
    const repo = makeRepo();
    vi.mocked(repo.revokeCredential).mockResolvedValue(false);
    const service = new AdoConnectionService(repo, makeProjectsClient(), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.disconnect('nobody', COLLECTION_KEY);
    expect(result.ok).toBe(false);
  });
});

describe('AdoConnectionService — getStatus', () => {
  const logger = createSilentLogger();

  it('returns sanitized status record (no encryptedPat)', async () => {
    const repo = makeRepo();
    const statusRecord = {
      appUserId: 'alice',
      adoCollectionKey: COLLECTION_KEY,
      status: 'connected' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findStatus).mockResolvedValue(statusRecord);
    const service = new AdoConnectionService(repo, makeProjectsClient(), TEST_KEY_B64, TEST_KEY_ID, logger);
    const result = await service.getStatus('alice', COLLECTION_KEY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data?.status as Record<string, unknown>)?.['encryptedPat']).toBeUndefined();
    }
  });
});
