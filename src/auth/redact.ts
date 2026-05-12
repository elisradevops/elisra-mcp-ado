import { redactDeep, redactString, REDACTED } from '../security/secretRedaction.js';

export { redactDeep, redactString };

/**
 * Sanitize an error before logging or returning to the caller.
 * Strips Authorization headers and PAT-shaped strings from all nested fields.
 */
export function redactError(err: unknown): Error {
  if (!(err instanceof Error)) {
    const msg = typeof err === 'string' ? redactString(err) : JSON.stringify(redactDeep(err));
    return new Error(msg);
  }

  // Axios error — strip config.headers, config.auth, request._header
  const axiosLike = err as unknown as Record<string, unknown>;
  if (axiosLike['config']) {
    const cfg = axiosLike['config'] as Record<string, unknown>;
    cfg['headers'] = REDACTED;
    cfg['auth'] = REDACTED;
  }
  if (axiosLike['request']) {
    const req = axiosLike['request'] as Record<string, unknown>;
    delete req['_header'];
    delete req['_headers'];
  }
  if (axiosLike['response']) {
    const res = axiosLike['response'] as Record<string, unknown>;
    if (res['config']) {
      const cfg = res['config'] as Record<string, unknown>;
      cfg['headers'] = REDACTED;
      cfg['auth'] = REDACTED;
    }
  }

  const safeMessage = redactString(err.message);
  const safe = new Error(safeMessage) as Error & Record<string, unknown>;
  safe.name = err.name;
  if (err.stack) {
    safe.stack = redactString(err.stack);
  }
  // Carry redacted axios props forward for diagnostic use (config, status, etc.)
  if (axiosLike['config']) safe['config'] = axiosLike['config'];
  if (axiosLike['status']) safe['status'] = axiosLike['status'];
  return safe;
}
