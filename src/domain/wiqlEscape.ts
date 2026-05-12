const MAX_WIQL_STRING_LENGTH = 4000;

// Control chars except \t (0x09), \n (0x0A), \r (0x0D)
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Escape a string value for use inside a WIQL single-quoted literal.
 * - Escapes `'` → `''`
 * - Rejects control characters that are illegal in WIQL
 * - Enforces a 4000-char length cap
 */
export function escapeWiqlString(value: string): string {
  if (value.length > MAX_WIQL_STRING_LENGTH) {
    throw new Error(
      `WIQL string value too long: ${value.length} chars (max ${MAX_WIQL_STRING_LENGTH}). ` +
      `Use CONTAINS with a shorter keyword instead.`
    );
  }
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(
      'WIQL string value contains illegal control characters. Remove them before filtering.'
    );
  }
  return value.replace(/'/g, "''");
}

/**
 * Wrap an escaped string in WIQL single quotes: `'value'`.
 */
export function quoteWiqlString(value: string): string {
  return `'${escapeWiqlString(value)}'`;
}

/**
 * Returns true when a string value should be emitted as a WIQL macro (not quoted).
 * Recognized macros: @project, @me, @today, @today - N, @startOfDay, @startOfWeek, @startOfMonth, @startOfYear
 */
export function isWiqlMacro(value: string): boolean {
  return /^@[a-zA-Z][a-zA-Z0-9]*(\s*[+-]\s*\d+)?$/.test(value.trim());
}

/**
 * Format a scalar value for a WIQL clause.
 * Handles: string (with macro detection), number, boolean.
 */
export function formatScalarValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`WIQL filter value must be a finite number, got: ${value}`);
    return String(value);
  }
  // string
  if (isWiqlMacro(value)) return value.trim();
  return quoteWiqlString(value);
}

/**
 * Format an array of values for WIQL IN / NOT IN: `('a', 'b')` or `(1, 2)`.
 */
export function formatArrayValue(values: string[] | number[]): string {
  if (values.length === 0) throw new Error('WIQL IN / NOT IN clause requires at least one value.');
  const formatted = (values as Array<string | number>).map((v) => formatScalarValue(v));
  return `(${formatted.join(', ')})`;
}
