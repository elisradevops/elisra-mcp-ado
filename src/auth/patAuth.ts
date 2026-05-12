/**
 * Build the HTTP Authorization header value for a given token.
 * - Bearer prefix → `Bearer <token>`
 * - PAT (base64 / alphanumeric) → `Basic <base64(":"+pat)>` (ADO on-prem standard)
 */
export function buildAuthHeader(token: string): string {
  const trimmed = token.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bearer:') || lower.startsWith('bearer ')) {
    const bearerValue = trimmed.slice(trimmed.indexOf(' ') !== -1 ? trimmed.indexOf(' ') + 1 : 7).trim();
    return `Bearer ${bearerValue}`;
  }
  return buildBasicAuthHeader(trimmed);
}

export function buildBasicAuthHeader(pat: string): string {
  const credentials = Buffer.from(`:${pat}`).toString('base64');
  return `Basic ${credentials}`;
}
