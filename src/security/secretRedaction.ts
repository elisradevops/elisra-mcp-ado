// ADO PATs are base64-encoded, typically 52 chars. Also match longer variants.
const PAT_SHAPE = /[A-Za-z0-9+/]{52,}={0,2}/g;

// Sensitive key names — any object key matching these gets value replaced
const SENSITIVE_KEY = /^(pat|token|secret|password|authorization|x-ado-pat|cookie|credential|apikey|api_key)$/i;

export const REDACTED = '<REDACTED>';
export const PAT_REDACTED = '<PAT_REDACTED>';

export function redactString(value: string): string {
  return value.replace(PAT_SHAPE, PAT_REDACTED);
}

export function redactDeep<T>(obj: T): T {
  if (typeof obj === 'string') {
    return redactString(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => redactDeep(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(value);
    }
    return result as T;
  }
  return obj;
}

export function isTlsError(err: unknown): boolean {
  const TLS_CODES = new Set([
    'CERT_UNTRUSTED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ]);
  const code = (err as Record<string, unknown>)?.['code'];
  const cause = ((err as Record<string, unknown>)?.['cause'] as Record<string, unknown>)?.['code'];
  return TLS_CODES.has(String(code)) || TLS_CODES.has(String(cause));
}
