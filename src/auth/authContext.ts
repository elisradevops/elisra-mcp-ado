import type { AppConfig } from '../config/config.js';

export type AuthMode = 'per_request_pat' | 'server_pat' | 'trusted_header_future';

export interface AuthContext {
  mode: AuthMode;
  pat?: string;
}

/**
 * Resolve the effective AuthContext for a single request.
 *
 * @param config  Application configuration (holds auth mode + server PAT if applicable)
 * @param requestPat  Per-request PAT from the tool call argument (per_request_pat mode only)
 */
export function resolveAuthContext(config: AppConfig, requestPat?: string): AuthContext {
  switch (config.adoAuthMode) {
    case 'server_pat':
      if (!config.adoPat) {
        throw new Error('Configuration error: ADO_AUTH_MODE=server_pat but ADO_PAT is not set.');
      }
      return { mode: 'server_pat', pat: config.adoPat };

    case 'per_request_pat':
      return { mode: 'per_request_pat', pat: requestPat };

    case 'trusted_header_future':
      throw new Error(
        'trusted_header_future auth mode is not implemented in this version. ' +
        'Use per_request_pat or server_pat.'
      );
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
