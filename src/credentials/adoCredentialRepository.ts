/**
 * Repository for per-user ADO PAT credentials stored in MongoDB.
 *
 * Collection: ado_user_credentials (configurable via ADO_CREDENTIALS_COLLECTION)
 *
 * Security invariants:
 * - encryptedPat is NEVER returned to callers outside this module except as the full EncryptedPat
 *   envelope for immediate in-memory decryption.
 * - The raw PAT is never stored, never logged, and never present in responses.
 * - Callers receive sanitized status/identity records — not credential documents.
 */

import type { Db, Collection } from 'mongodb';
import type { EncryptedPat } from '../crypto/patEncryption.js';
import type { Logger } from '../logging/logger.js';

export type CredentialStatus = 'connected' | 'invalid' | 'revoked' | 'expired';

export interface AdoCredentialDocument {
  appUserId: string;
  /** Normalized ADO collection URL key, e.g. "https://tfs.example.local/tfs/DefaultCollection" */
  adoCollectionKey: string;
  adoIdentityDisplayName?: string;
  adoIdentityUniqueName?: string;
  encryptedPat: EncryptedPat;
  patExpiresAt?: Date;
  status: CredentialStatus;
  createdAt: Date;
  updatedAt: Date;
  lastValidatedAt?: Date;
  lastUsedAt?: Date;
}

/** Public-safe view — omits encryptedPat entirely. */
export interface CredentialStatusRecord {
  appUserId: string;
  adoCollectionKey: string;
  adoIdentityDisplayName?: string;
  adoIdentityUniqueName?: string;
  status: CredentialStatus;
  patExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastValidatedAt?: Date;
  lastUsedAt?: Date;
}

export class AdoCredentialRepository {
  private readonly col: Collection<AdoCredentialDocument>;

  constructor(db: Db, collectionName: string) {
    this.col = db.collection<AdoCredentialDocument>(collectionName);
  }

  /** Create indexes — call once at startup. Idempotent. */
  async ensureIndexes(logger: Logger): Promise<void> {
    try {
      await this.col.createIndex(
        { appUserId: 1, adoCollectionKey: 1 },
        { unique: true, name: 'uq_user_collection' }
      );
      await this.col.createIndex({ status: 1 }, { name: 'idx_status' });
      await this.col.createIndex({ patExpiresAt: 1 }, { sparse: true, name: 'idx_expires' });
      logger.info({ collection: this.col.collectionName }, 'ADO credential indexes ensured');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ collection: this.col.collectionName, message }, 'Failed to create credential indexes');
      throw err;
    }
  }

  /**
   * Upsert a credential. Only accepts an EncryptedPat — raw PAT must be encrypted by caller
   * before calling this method.
   */
  async upsertCredential(
    appUserId: string,
    adoCollectionKey: string,
    encryptedPat: EncryptedPat,
    identityMeta: { displayName?: string; uniqueName?: string },
    patExpiresAt?: Date,
  ): Promise<void> {
    const now = new Date();
    await this.col.updateOne(
      { appUserId, adoCollectionKey },
      {
        $set: {
          encryptedPat,
          adoIdentityDisplayName: identityMeta.displayName,
          adoIdentityUniqueName: identityMeta.uniqueName,
          patExpiresAt,
          status: 'connected' as const,
          updatedAt: now,
          lastValidatedAt: now,
        },
        $setOnInsert: {
          appUserId,
          adoCollectionKey,
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }

  /**
   * Load the full credential document (including encryptedPat) for PAT resolution.
   * Returns null if no credential exists.
   *
   * Legitimate callers:
   *   - UserPatResolver.resolve()     — per-request ADO auth resolution (primary use)
   *   - AdoConnectionService.test()  — PAT validation without a round-trip through the resolver
   *
   * Do NOT expose the returned document to HTTP responses, tool results, or log entries.
   * Callers must decrypt in memory and discard the plaintext after use.
   */
  async findForAuth(appUserId: string, adoCollectionKey: string): Promise<AdoCredentialDocument | null> {
    return this.col.findOne(
      { appUserId, adoCollectionKey },
      { projection: { _id: 0 } }
    );
  }

  /**
   * Load sanitized status record — safe to return in API responses.
   * encryptedPat is explicitly excluded.
   */
  async findStatus(appUserId: string, adoCollectionKey: string): Promise<CredentialStatusRecord | null> {
    return this.col.findOne(
      { appUserId, adoCollectionKey },
      { projection: { _id: 0, encryptedPat: 0 } }
    ) as Promise<CredentialStatusRecord | null>;
  }

  /** Mark credential as revoked. Does not delete the document (preserves audit trail). */
  async revokeCredential(appUserId: string, adoCollectionKey: string): Promise<boolean> {
    const result = await this.col.updateOne(
      { appUserId, adoCollectionKey },
      { $set: { status: 'revoked' as const, updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
  }

  /** Mark credential as invalid (e.g. PAT rejected by ADO). */
  async markInvalid(appUserId: string, adoCollectionKey: string): Promise<void> {
    await this.col.updateOne(
      { appUserId, adoCollectionKey },
      { $set: { status: 'invalid' as const, updatedAt: new Date() } }
    );
  }

  /** Update lastUsedAt timestamp after a successful ADO call. */
  async touchLastUsed(appUserId: string, adoCollectionKey: string): Promise<void> {
    await this.col.updateOne(
      { appUserId, adoCollectionKey },
      { $set: { lastUsedAt: new Date() } }
    );
  }

  /** Hard-delete a credential document. Use revokeCredential() to preserve audit trail instead. */
  async deleteCredential(appUserId: string, adoCollectionKey: string): Promise<boolean> {
    const result = await this.col.deleteOne({ appUserId, adoCollectionKey });
    return result.deletedCount > 0;
  }
}
