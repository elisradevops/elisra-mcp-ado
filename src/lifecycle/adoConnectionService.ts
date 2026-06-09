/**
 * ADO credential lifecycle service — connect, test, rotate, disconnect.
 *
 * IMPORTANT: These operations are NOT exposed as MCP tools to the LLM.
 * PAT input comes from secure settings/onboarding forms, not chat or tool arguments.
 * The routes are at /ado/connection/* on the HTTP server, protected by trusted user identity.
 *
 * Each operation emits a structured audit log event.
 */

import type { AdoCredentialRepository, CredentialStatusRecord } from '../credentials/adoCredentialRepository.js';
import { encryptPat } from '../crypto/patEncryption.js';
import type { ProjectsClient } from '../ado/projectsClient.js';
import type { AuthContext } from '../auth/authContext.js';
import type { Logger } from '../logging/logger.js';

export interface ConnectPatInput {
  appUserId: string;
  adoCollectionKey: string;
  rawPat: string;
  patExpiresAt?: Date;
}

export interface LifecycleResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ConnectionStatusData {
  status: CredentialStatusRecord | null;
}

export interface ConnectResultData {
  adoIdentityDisplayName?: string;
  adoIdentityUniqueName?: string;
}

export class AdoConnectionService {
  constructor(
    private readonly repo: AdoCredentialRepository,
    private readonly projectsClient: ProjectsClient,
    private readonly keyB64: string,
    private readonly keyId: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Connect (or update) a user's ADO PAT.
   * Validates the PAT against ADO, captures identity, then encrypts and stores.
   * The raw PAT is never stored and not returned.
   */
  async connect(input: ConnectPatInput, requestId?: string): Promise<LifecycleResult<ConnectResultData>> {
    const auditBase = { appUserId: input.appUserId, adoCollectionKey: input.adoCollectionKey, operation: 'connect', requestId };

    if (!input.rawPat || input.rawPat.trim().length === 0) {
      return { ok: false, error: 'PAT must not be empty' };
    }

    // Validate PAT against ADO before storing
    const tempAuth: AuthContext = { mode: 'trusted_user_header', pat: input.rawPat.trim(), source: 'trusted_header', appUserId: input.appUserId };
    let displayName: string | undefined;
    let uniqueName: string | undefined;

    try {
      const connectionData = await this.projectsClient.getConnectionData(tempAuth);
      displayName = connectionData.authenticatedUser?.providerDisplayName;
      uniqueName = connectionData.authenticatedUser?.subjectDescriptor ?? connectionData.authenticatedUser?.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ ...auditBase, success: false, sanitizedError: message }, 'PAT validation against ADO failed during connect');
      return { ok: false, error: 'PAT validation failed — check the PAT is valid and has the required scopes' };
    }

    let encrypted;
    try {
      encrypted = encryptPat(input.rawPat.trim(), this.keyB64, this.keyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ ...auditBase, success: false, sanitizedError: message }, 'PAT encryption failed');
      return { ok: false, error: 'Internal error during credential storage' };
    }

    try {
      await this.repo.upsertCredential(
        input.appUserId,
        input.adoCollectionKey,
        encrypted,
        { displayName, uniqueName },
        input.patExpiresAt,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ ...auditBase, success: false, sanitizedError: message }, 'Failed to store credential');
      return { ok: false, error: 'Failed to store credential' };
    }

    this.logger.info({ ...auditBase, success: true, adoIdentity: uniqueName }, 'ADO credential connected');
    return { ok: true, data: { adoIdentityDisplayName: displayName, adoIdentityUniqueName: uniqueName } };
  }

  /**
   * Test the currently stored PAT for a user. Returns identity or error.
   * Does not modify the stored credential.
   */
  async test(appUserId: string, adoCollectionKey: string, requestId?: string): Promise<LifecycleResult<ConnectResultData>> {
    const auditBase = { appUserId, adoCollectionKey, operation: 'test', requestId };

    const doc = await this.repo.findForAuth(appUserId, adoCollectionKey);
    if (!doc) {
      return { ok: false, error: 'No credential stored for this user' };
    }
    if (doc.status === 'revoked') {
      return { ok: false, error: 'Credential has been revoked' };
    }

    let pat: string;
    try {
      const { decryptPatAsString } = await import('../crypto/patEncryption.js');
      pat = decryptPatAsString(doc.encryptedPat, this.keyB64, this.keyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ ...auditBase, success: false, sanitizedError: message }, 'PAT decryption failed during test');
      return { ok: false, error: 'Failed to decrypt stored credential' };
    }

    const tempAuth: AuthContext = { mode: 'trusted_user_header', pat, source: 'trusted_header', appUserId };

    try {
      const connectionData = await this.projectsClient.getConnectionData(tempAuth);
      const displayName = connectionData.authenticatedUser?.providerDisplayName;
      const uniqueName = connectionData.authenticatedUser?.subjectDescriptor ?? connectionData.authenticatedUser?.id;
      this.logger.info({ ...auditBase, success: true, adoIdentity: uniqueName }, 'ADO credential test passed');
      return { ok: true, data: { adoIdentityDisplayName: displayName, adoIdentityUniqueName: uniqueName } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.markInvalid(appUserId, adoCollectionKey).catch(() => { /* non-fatal */ });
      this.logger.warn({ ...auditBase, success: false, sanitizedError: message }, 'ADO credential test failed');
      return { ok: false, error: 'PAT test failed — credential marked invalid' };
    }
  }

  /**
   * Replace a user's PAT (rotate). Validates new PAT before replacing.
   */
  async rotate(input: ConnectPatInput, requestId?: string): Promise<LifecycleResult<ConnectResultData>> {
    const auditBase = { appUserId: input.appUserId, adoCollectionKey: input.adoCollectionKey, operation: 'rotate', requestId };
    this.logger.info({ ...auditBase }, 'Rotating ADO credential');
    // Rotate is connect + explicit audit marker — reuse connect logic
    return this.connect(input, requestId);
  }

  /** Get the sanitized status of a user's credential (no PAT data returned). */
  async getStatus(appUserId: string, adoCollectionKey: string): Promise<LifecycleResult<ConnectionStatusData>> {
    const status = await this.repo.findStatus(appUserId, adoCollectionKey);
    return { ok: true, data: { status } };
  }

  /**
   * Disconnect (revoke) a user's stored ADO credential.
   * Marks status=revoked. Use deleteCredential() to hard-delete.
   */
  async disconnect(appUserId: string, adoCollectionKey: string, requestId?: string): Promise<LifecycleResult> {
    const auditBase = { appUserId, adoCollectionKey, operation: 'disconnect', requestId };
    const found = await this.repo.revokeCredential(appUserId, adoCollectionKey);
    if (!found) {
      return { ok: false, error: 'No credential found to disconnect' };
    }
    this.logger.info({ ...auditBase, success: true }, 'ADO credential disconnected');
    return { ok: true };
  }
}
