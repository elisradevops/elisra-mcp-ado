import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext } from '../auth/authContext.js';

export interface RequestContext {
  requestId: string;
  toolName: string;
  /**
   * Authenticated app user ID — set by the HTTP transport layer when
   * ADO_AUTH_MODE=trusted_user_header. Undefined in server_pat and per_request_pat modes.
   * Used by resolveAuthContext() to read the pre-resolved ADO auth without tool arg exposure.
   */
  appUserId?: string;
  /**
   * Pre-resolved ADO AuthContext for trusted_user_header mode.
   * Set by httpServer.ts after MongoDB lookup + PAT decryption, before MCP request handling.
   * resolveAuthContext() reads this instead of repeating the DB lookup per tool call.
   * Lives only for the duration of the request — not persisted or logged.
   */
  resolvedAuth?: AuthContext;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
