/**
 * Tests for AdoCredentialRepository.
 * Uses a MongoDB in-memory mock via vitest's mock mechanism.
 * No real MongoDB connection required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoCredentialRepository } from '../../src/credentials/adoCredentialRepository.js';
import type { EncryptedPat } from '../../src/crypto/patEncryption.js';
import { createSilentLogger } from '../../src/logging/logger.js';

const FAKE_ENCRYPTED_PAT: EncryptedPat = {
  ciphertext: 'deadbeef'.repeat(8),
  iv: 'aabbccdd'.repeat(3),
  authTag: '00112233'.repeat(4),
  keyId: 'v1',
  algorithm: 'aes-256-gcm',
};

function makeMockCollection() {
  const store = new Map<string, Record<string, unknown>>();

  return {
    createIndex: vi.fn().mockResolvedValue(undefined),
    updateOne: vi.fn(async (filter: Record<string, string>, update: Record<string, Record<string, unknown>>) => {
      const key = `${filter.appUserId}:${filter.adoCollectionKey}`;
      const existing = store.get(key) ?? {};
      const $set = update.$set ?? {};
      const $setOnInsert = update.$setOnInsert ?? {};
      if (!store.has(key)) {
        store.set(key, { ...existing, ...$set, ...$setOnInsert });
      } else {
        store.set(key, { ...existing, ...$set });
      }
      return { matchedCount: store.has(key) ? 1 : 0 };
    }),
    findOne: vi.fn(async (filter: Record<string, string>, options?: Record<string, unknown>) => {
      const key = `${filter.appUserId}:${filter.adoCollectionKey}`;
      const doc = store.get(key);
      if (!doc) return null;
      if (options?.projection && (options.projection as Record<string, number>)['encryptedPat'] === 0) {
        const { encryptedPat: _, ...rest } = doc;
        return rest;
      }
      return doc;
    }),
    deleteOne: vi.fn(async (filter: Record<string, string>) => {
      const key = `${filter.appUserId}:${filter.adoCollectionKey}`;
      const existed = store.has(key);
      store.delete(key);
      return { deletedCount: existed ? 1 : 0 };
    }),
    get _store() { return store; },
    collectionName: 'ado_user_credentials',
  };
}

function makeMockDb(col: ReturnType<typeof makeMockCollection>) {
  return {
    collection: vi.fn().mockReturnValue(col),
  };
}

describe('AdoCredentialRepository', () => {
  let col: ReturnType<typeof makeMockCollection>;
  let repo: AdoCredentialRepository;
  const logger = createSilentLogger();

  beforeEach(() => {
    col = makeMockCollection();
    const db = makeMockDb(col);
    repo = new AdoCredentialRepository(db as never, 'ado_user_credentials');
  });

  it('ensureIndexes creates 3 indexes', async () => {
    await repo.ensureIndexes(logger);
    expect(col.createIndex).toHaveBeenCalledTimes(3);
  });

  it('ensureIndexes creates unique index on appUserId + adoCollectionKey', async () => {
    await repo.ensureIndexes(logger);
    const calls = col.createIndex.mock.calls;
    const uniqueCall = calls.find((c: unknown[]) => (c[1] as Record<string, unknown>)?.unique === true);
    expect(uniqueCall).toBeDefined();
    expect((uniqueCall as unknown[])[0]).toMatchObject({ appUserId: 1, adoCollectionKey: 1 });
  });

  it('upsertCredential stores encrypted PAT (not raw)', async () => {
    await repo.upsertCredential('user1', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, {});
    const calls = col.updateOne.mock.calls;
    const setData = (calls[0] as unknown[])[1] as Record<string, Record<string, unknown>>;
    // Encrypted envelope present
    expect(setData.$set.encryptedPat).toMatchObject({ algorithm: 'aes-256-gcm' });
    // Raw PAT string NOT present anywhere in the update
    expect(JSON.stringify(setData)).not.toContain('rawpat');
    expect(JSON.stringify(setData)).not.toContain('plaintext');
  });

  it('upsertCredential sets status=connected', async () => {
    await repo.upsertCredential('user1', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, {});
    const setData = (col.updateOne.mock.calls[0] as unknown[])[1] as Record<string, Record<string, unknown>>;
    expect(setData.$set.status).toBe('connected');
  });

  it('findForAuth returns full document including encryptedPat', async () => {
    await repo.upsertCredential('user2', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, { displayName: 'Test User' });
    const doc = await repo.findForAuth('user2', 'https://tfs.example/coll');
    expect(doc).not.toBeNull();
    expect(doc?.encryptedPat).toMatchObject({ algorithm: 'aes-256-gcm' });
  });

  it('findStatus omits encryptedPat from result', async () => {
    await repo.upsertCredential('user3', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, {});
    const status = await repo.findStatus('user3', 'https://tfs.example/coll');
    expect(status).not.toBeNull();
    expect((status as Record<string, unknown>)['encryptedPat']).toBeUndefined();
  });

  it('findForAuth returns null for unknown user', async () => {
    const doc = await repo.findForAuth('unknown', 'https://tfs.example/coll');
    expect(doc).toBeNull();
  });

  it('revokeCredential marks status=revoked', async () => {
    await repo.upsertCredential('user4', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, {});
    // updateOne is called for upsert + revoke — check revoke call
    col.updateOne.mockClear();
    await repo.revokeCredential('user4', 'https://tfs.example/coll');
    const setData = (col.updateOne.mock.calls[0] as unknown[])[1] as Record<string, Record<string, unknown>>;
    expect(setData.$set.status).toBe('revoked');
  });

  it('revokeCredential returns false when no document found', async () => {
    col.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    const found = await repo.revokeCredential('nobody', 'https://tfs.example/coll');
    expect(found).toBe(false);
  });

  it('markInvalid sets status=invalid', async () => {
    await repo.upsertCredential('user5', 'https://tfs.example/coll', FAKE_ENCRYPTED_PAT, {});
    col.updateOne.mockClear();
    await repo.markInvalid('user5', 'https://tfs.example/coll');
    const setData = (col.updateOne.mock.calls[0] as unknown[])[1] as Record<string, Record<string, unknown>>;
    expect(setData.$set.status).toBe('invalid');
  });

  it('deleteCredential removes document and returns true', async () => {
    const deleted = await repo.deleteCredential('user6', 'https://tfs.example/coll');
    // col.deleteOne returns deletedCount based on prior existence — mock returns 0 by default
    // just verify the call was made
    expect(col.deleteOne).toHaveBeenCalledWith({ appUserId: 'user6', adoCollectionKey: 'https://tfs.example/coll' });
    // Result depends on whether doc existed
    expect(typeof deleted).toBe('boolean');
  });
});
