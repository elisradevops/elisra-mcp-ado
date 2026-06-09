/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Intended for single-instance deployments only. For multi-instance deployments,
 * replace with a shared-store rate limiter (Redis, etc.) or offload to ingress-level
 * rate limiting (nginx limit_req, API gateway).
 *
 * Usage: protect lifecycle mutation endpoints from brute-force and DoS.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class SimpleRateLimiter {
  private readonly windows = new Map<string, Window>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Check whether the request for the given key is within the rate limit.
   * Increments the counter on each call. Returns false when limit is exceeded.
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (existing.count >= this.maxRequests) {
      return false;
    }

    existing.count++;
    return true;
  }

  /**
   * Remove expired windows. Call periodically to prevent unbounded memory growth.
   * Returns number of entries removed.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, window] of this.windows.entries()) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Start a periodic cleanup interval. Call once at server startup. */
  startCleanup(intervalMs = 300_000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    // Don't prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Current number of tracked windows. Test use only. */
  get _windowCount(): number {
    return this.windows.size;
  }
}
