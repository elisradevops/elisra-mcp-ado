/**
 * Trusted user identity extraction for the trusted_user_header auth mode.
 *
 * SECURITY CONTRACT:
 * The headers read here MUST only be injected by a trusted upstream layer:
 *   - Open WebUI backend (when proxying to the MCP server)
 *   - A trusted reverse proxy (e.g. nginx with auth_request)
 *   - An internal service mesh layer
 *
 * NEVER trust these headers if they can be supplied directly by a browser/client.
 * Ensure the trusted header name is NOT one that HTTP clients can set freely
 * (e.g. if behind Open WebUI, ensure Open WebUI strips and re-injects the header).
 *
 * The header name is configurable via TRUSTED_USER_HEADER env var (default: x-forwarded-user).
 * Header names are normalized to lowercase by env.ts.
 */

import type { IncomingHttpHeaders } from 'node:http';

const MAX_USER_ID_LENGTH = 256;
// Allow printable ASCII except control chars, <, >, &, quotes
const SAFE_USER_ID_RE = /^[\x20-\x7E]+$/;

export interface TrustedUserIdentity {
  appUserId: string;
  displayName?: string;
}

export type TrustedIdentityResult =
  | { ok: true; identity: TrustedUserIdentity }
  | { ok: false; reason: string };

/**
 * Extract and validate the trusted user identity from HTTP request headers.
 * Returns ok:false if the header is missing, empty, or contains invalid characters.
 */
export function extractTrustedIdentity(
  headers: IncomingHttpHeaders,
  trustedUserHeader: string,
  trustedUserNameHeader?: string,
): TrustedIdentityResult {
  const rawId = headers[trustedUserHeader];

  if (!rawId) {
    return { ok: false, reason: `Trusted user header "${trustedUserHeader}" is missing` };
  }

  const userId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!userId || userId.trim().length === 0) {
    return { ok: false, reason: `Trusted user header "${trustedUserHeader}" is empty` };
  }

  const trimmed = userId.trim();

  if (trimmed.length > MAX_USER_ID_LENGTH) {
    return { ok: false, reason: `Trusted user ID exceeds maximum length (${MAX_USER_ID_LENGTH})` };
  }

  if (!SAFE_USER_ID_RE.test(trimmed)) {
    return { ok: false, reason: 'Trusted user ID contains invalid characters' };
  }

  let displayName: string | undefined;
  if (trustedUserNameHeader) {
    const rawName = headers[trustedUserNameHeader];
    if (rawName) {
      const name = Array.isArray(rawName) ? rawName[0] : rawName;
      if (name && name.trim().length > 0) {
        displayName = name.trim().slice(0, 256);
      }
    }
  }

  return { ok: true, identity: { appUserId: trimmed, displayName } };
}
