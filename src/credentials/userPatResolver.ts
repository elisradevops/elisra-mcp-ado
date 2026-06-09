/**
 * Resolves a per-user ADO PAT from the credential store and builds an AuthContext.
 *
 * This is the ONLY place where encrypted PATs are decrypted for use in ADO calls.
 * The decrypted PAT is placed directly into an AuthContext — it is never returned,
 * never logged, and never stored beyond the lifetime of the AuthContext object.
 *
 * Audit events are emitted here for all resolution outcomes (success and failure).
 */

import type { AdoCredentialRepository } from './adoCredentialRepository.js';
import { decryptPatAsString } from '../crypto/patEncryption.js';
import type { AuthContext } from '../auth/authContext.js';
import type { Logger } from '../logging/logger.js';

export interface ResolvePatOptions {
  appUserId: string;
  adoCollectionKey: string;
  keyB64: string;
  keyId: string;
  requestId?: string;
}

export type ResolvePatResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; reason: string; httpStatus: 401 | 403 | 404 | 500 };

export class UserPatResolver {
  constructor(
    private readonly repo: AdoCredentialRepository,
    private readonly logger: Logger,
  ) {}

  async resolve(opts: ResolvePatOptions): Promise<ResolvePatResult> {
    const { appUserId, adoCollectionKey, keyB64, keyId, requestId } = opts;

    const auditBase = { appUserId, adoCollectionKey, requestId };

    let doc;
    try {
      doc = await this.repo.findForAuth(appUserId, adoCollectionKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ ...auditBase, operation: 'resolver_lookup', success: false, sanitizedError: message }, 'Credential lookup failed');
      return { ok: false, reason: 'Credential store unavailable', httpStatus: 500 };
    }

    if (!doc) {
      this.logger.warn({ ...auditBase, operation: 'resolver_lookup', success: false }, 'No credential found for user');
      return { ok: false, reason: 'No ADO credential registered for this user', httpStatus: 404 };
    }

    if (doc.status !== 'connected') {
      this.logger.warn({ ...auditBase, operation: 'resolver_lookup', success: false, credentialStatus: doc.status }, 'Credential is not in connected state');
      return {
        ok: false,
        reason: `ADO credential status is "${doc.status}" — please reconnect via the settings endpoint`,
        httpStatus: 403,
      };
    }

    if (doc.patExpiresAt && doc.patExpiresAt < new Date()) {
      await this.repo.markInvalid(appUserId, adoCollectionKey).catch(() => { /* non-fatal */ });
      this.logger.warn({ ...auditBase, operation: 'resolver_lookup', success: false }, 'Credential PAT has expired');
      return { ok: false, reason: 'ADO credential PAT has expired — please reconnect', httpStatus: 401 };
    }

    let decryptedPat: string;
    try {
      decryptedPat = decryptPatAsString(doc.encryptedPat, keyB64, keyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ ...auditBase, operation: 'resolver_decrypt', success: false, sanitizedError: message }, 'PAT decryption failed');
      return { ok: false, reason: 'Failed to decrypt stored ADO credential', httpStatus: 500 };
    }

    // Update lastUsedAt non-critically in background
    this.repo.touchLastUsed(appUserId, adoCollectionKey).catch(() => { /* non-fatal */ });

    this.logger.info({ ...auditBase, operation: 'resolver_lookup', success: true, adoIdentity: doc.adoIdentityUniqueName }, 'ADO credential resolved');

    const auth: AuthContext = {
      mode: 'trusted_user_header',
      pat: decryptedPat,
      source: 'trusted_header',
      appUserId,
    };

    return { ok: true, auth };
  }
}
