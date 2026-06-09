import type { AppConfig } from '../config/config.js';
import { getRequestContext } from '../utils/requestContext.js';

export type AuthMode = 'per_request_pat' | 'server_pat' | 'trusted_user_header';

/**
 * Where the credential originated in the current call.
 *  - tool_arg:       PAT was supplied as a tool call argument (per_request_pat mode — NOT production-safe).
 *  - server_env:     PAT was loaded from server environment (server_pat mode — shared service account).
 *  - trusted_header: PAT was resolved from a trusted upstream identity header (trusted_user_header mode).
 */
export type CredentialSource = 'tool_arg' | 'server_env' | 'trusted_header';

export interface AuthContext {
  mode: AuthMode;
  /**
   * Decrypted ADO PAT — present in memory only during the ADO call.
   * Never log, never return, never store after use.
   */
  pat?: string;
  /**
   * Transport-level credential origin. Used for audit logging.
   */
  source?: CredentialSource;
  /**
   * App-level authenticated user ID (e.g. Open WebUI user ID).
   * Populated in trusted_user_header mode. Undefined in server_pat / per_request_pat modes.
   */
  appUserId?: string;
}

/**
 * Resolve the effective AuthContext for a single tool call.
 *
 * In trusted_user_header mode, this reads the pre-resolved AuthContext from AsyncLocalStorage.
 * The HTTP transport layer (httpServer.ts) sets this context before the MCP session begins
 * by: (1) extracting the trusted user header, (2) looking up the credential from MongoDB,
 * (3) decrypting the PAT in memory, (4) placing the AuthContext in requestContextStorage.
 * This avoids a per-tool-call MongoDB round-trip and keeps PAT resolution outside tool args.
 *
 * STDIO transport + trusted_user_header: fails closed — no HTTP headers available.
 */
export function resolveAuthContext(config: AppConfig, requestPat?: string): AuthContext {
  switch (config.adoAuthMode) {
    case 'server_pat':
      if (!config.adoPat) {
        throw new Error('Configuration error: ADO_AUTH_MODE=server_pat but ADO_PAT is not set.');
      }
      return { mode: 'server_pat', pat: config.adoPat, source: 'server_env' };

    case 'per_request_pat':
      // SECURITY NOTE: PAT travels through tool-call JSON, LLM context, proxy access logs, and
      // potentially Open WebUI conversation history. ADO_AUTH_MODE=per_request_pat must NOT be
      // used in production. Gated by ADO_ALLOW_PAT_IN_TOOL_ARGS=true at startup.
      return { mode: 'per_request_pat', pat: requestPat, source: 'tool_arg' };

    case 'trusted_user_header': {
      // Read the pre-resolved AuthContext placed by httpServer.ts before MCP session start.
      // If missing, fail closed — no PAT guessing, no fallback to server PAT.
      const ctx = getRequestContext();
      if (ctx?.resolvedAuth) {
        return ctx.resolvedAuth;
      }
      // No pre-resolved auth: either stdio transport (no HTTP headers) or a bug.
      throw new Error(
        'trusted_user_header: no resolved ADO auth found in request context. ' +
        'This mode requires the HTTP transport — stdio/MCPO transport cannot carry user identity headers. ' +
        'If using HTTP transport, ensure the upstream layer injects the trusted user header correctly.'
      );
    }
  }
}

export function requirePat(auth: AuthContext): string {
  if (!auth.pat) {
    throw new Error(
      'A PAT is required for this request. ' +
      'Provide it via the tool "auth.pat" argument (per_request_pat mode).'
    );
  }
  return auth.pat;
}
