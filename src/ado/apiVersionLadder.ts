// API version fallback ladder — matches DocGen's on-prem TFS compatibility pattern.
// Newer api-versions are rejected by older on-prem TFS instances (400/404/405/410).
// The ladder tries highest first and steps down on rejection.

export const API_VERSION_LADDER = ['7.1', '5.1', null] as const;
export type ApiVersion = (typeof API_VERSION_LADDER)[number];

const STEP_DOWN_STATUSES = new Set([400, 404, 405, 406, 410]);

export function shouldStepDown(httpStatus: number): boolean {
  return STEP_DOWN_STATUSES.has(httpStatus);
}

/**
 * Execute `fn` with api-version from the ladder, stepping down on rejection.
 * `fn` receives the current api-version (may be null for no version param).
 */
export async function withApiVersionFallback<T>(
  ladder: readonly (string | null)[],
  fn: (version: string | null) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const version of ladder) {
    try {
      return await fn(version);
    } catch (err) {
      const status: number | undefined = (err as { status?: number; response?: { status?: number } })
        ?.response?.status ?? (err as { status?: number })?.status;
      if (status !== undefined && shouldStepDown(status)) {
        lastError = err;
        continue;
      }
      throw err; // non-step-down error — propagate immediately
    }
  }
  throw lastError;
}
