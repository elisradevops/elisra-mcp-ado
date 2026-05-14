const MAX_WIQL_STRING_LENGTH = 4000;

// Control chars except \t (0x09), \n (0x0A), \r (0x0D)
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// ─── Macro allow-list ─────────────────────────────────────────────────────────

const VALID_MACRO_NAMES = new Set([
  'me', 'today', 'project', 'currentiteration',
  'startofday', 'startofweek', 'startofmonth', 'startofyear',
  'follows', 'myrecentactivity', 'teamareas', 'recentmentions', 'recentprojectactivity',
]);

// Matches: @Name, @Name('arg'), @Name ± N[d|w|mo|y] (digits capped at 4 to block absurd offsets)
const MACRO_RE = /^@([A-Za-z][A-Za-z0-9]*)(\('[^']+'\))?(\s*[+-]\s*\d{1,4}\s*(?:d|w|mo|y)?)?$/;

// @StartOf* macros were added in ADO Server 2019 (api-version 5.0).
const MACRO_MIN_API_VERSION: Record<string, string> = {
  startofday: '5.0',
  startofweek: '5.0',
  startofmonth: '5.0',
  startofyear: '5.0',
};

/**
 * Return the minimum api-version required for a given macro name (lower-cased).
 * Returns null for macros that work on all supported TFS/ADO versions.
 */
export function getMacroMinApiVersion(name: string): string | null {
  return MACRO_MIN_API_VERSION[name.toLowerCase()] ?? null;
}

/**
 * Validate a WIQL macro string against the allow-list.
 * Returns the trimmed value on success; throws on unknown name or malformed syntax.
 */
export function validateMacro(value: string): string {
  const trimmed = value.trim();
  const m = MACRO_RE.exec(trimmed);
  if (!m) {
    throw new Error(
      `Invalid WIQL macro syntax: "${value}". ` +
      `Expected @MacroName, @MacroName('arg'), or @MacroName ± N[d|w|mo|y].`
    );
  }
  const name = m[1].toLowerCase();
  if (!VALID_MACRO_NAMES.has(name)) {
    const valid = [...VALID_MACRO_NAMES].map((n) => `@${n}`).join(', ');
    throw new Error(`Unknown WIQL macro "@${m[1]}". Valid macros: ${valid}.`);
  }
  // Validate parameterized arg content against control characters
  const arg = m[2]; // e.g. "('[MyProj]\\TeamA')"
  if (arg && CONTROL_CHAR_RE.test(arg)) {
    throw new Error('WIQL macro argument contains illegal control characters.');
  }
  return trimmed;
}

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
 * Returns true when a string value looks like a WIQL macro (starts with @letter).
 * Call validateMacro() to confirm the name is in the allow-list.
 */
export function isWiqlMacro(value: string): boolean {
  return MACRO_RE.test(value.trim());
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
  if (isWiqlMacro(value)) return validateMacro(value);
  return quoteWiqlString(value);
}

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T[\d:.Z+\-]+)?$/;

/**
 * Validate and format an ASOF clause value.
 * Accepts: WIQL macro (@Today, @Today - 7d) or ISO date (2025-01-01).
 * Returns the formatted token — quoted for dates, unquoted for macros.
 */
export function formatAsOf(value: string): string {
  const trimmed = value.trim();
  if (isWiqlMacro(trimmed)) return validateMacro(trimmed);
  if (!ISO_DATE_RE.test(trimmed)) {
    throw new Error(
      `Invalid ASOF value "${value}". Must be an ISO date (e.g. 2025-01-01) or a WIQL macro (e.g. @Today - 7d).`
    );
  }
  return `'${trimmed}'`;
}

/**
 * Format an array of values for WIQL IN / NOT IN: `('a', 'b')` or `(1, 2)`.
 */
export function formatArrayValue(values: string[] | number[]): string {
  if (values.length === 0) throw new Error('WIQL IN / NOT IN clause requires at least one value.');
  const formatted = (values as Array<string | number>).map((v) => formatScalarValue(v));
  return `(${formatted.join(', ')})`;
}
