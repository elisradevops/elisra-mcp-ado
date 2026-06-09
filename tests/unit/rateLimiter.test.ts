import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleRateLimiter } from '../../src/utils/rateLimiter.js';

describe('SimpleRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', () => {
    const limiter = new SimpleRateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed('user-a')).toBe(true);
    }
  });

  it('blocks the request that exceeds the limit', () => {
    const limiter = new SimpleRateLimiter(3, 60_000);
    limiter.isAllowed('user-a');
    limiter.isAllowed('user-a');
    limiter.isAllowed('user-a');
    // 4th request — over limit
    expect(limiter.isAllowed('user-a')).toBe(false);
  });

  it('allows requests again after window expires', () => {
    const limiter = new SimpleRateLimiter(2, 60_000);
    limiter.isAllowed('user-b');
    limiter.isAllowed('user-b');
    expect(limiter.isAllowed('user-b')).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(limiter.isAllowed('user-b')).toBe(true);
  });

  it('tracks separate keys independently', () => {
    const limiter = new SimpleRateLimiter(1, 60_000);
    expect(limiter.isAllowed('user-x')).toBe(true);
    expect(limiter.isAllowed('user-x')).toBe(false);
    // Different key is independent
    expect(limiter.isAllowed('user-y')).toBe(true);
  });

  it('cleanup removes expired windows', () => {
    const limiter = new SimpleRateLimiter(5, 60_000);
    limiter.isAllowed('user-c');
    limiter.isAllowed('user-d');
    expect(limiter._windowCount).toBe(2);

    vi.advanceTimersByTime(60_001);
    const removed = limiter.cleanup();
    expect(removed).toBe(2);
    expect(limiter._windowCount).toBe(0);
  });

  it('cleanup does not remove active windows', () => {
    const limiter = new SimpleRateLimiter(5, 60_000);
    limiter.isAllowed('user-e');

    vi.advanceTimersByTime(30_000); // half-window
    const removed = limiter.cleanup();
    expect(removed).toBe(0);
    expect(limiter._windowCount).toBe(1);
  });

  it('startCleanup / stopCleanup lifecycle', () => {
    const limiter = new SimpleRateLimiter(5, 60_000);
    limiter.startCleanup(300_000);
    limiter.isAllowed('user-f');
    expect(limiter._windowCount).toBe(1);
    limiter.stopCleanup();
  });

  it('startCleanup is idempotent', () => {
    const limiter = new SimpleRateLimiter(5, 60_000);
    limiter.startCleanup(300_000);
    limiter.startCleanup(300_000); // second call is no-op
    limiter.stopCleanup();
  });
});
