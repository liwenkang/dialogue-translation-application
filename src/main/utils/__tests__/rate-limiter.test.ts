import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests within the limit", () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("should reject requests exceeding the limit", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("should allow requests again after the window expires", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("should handle sliding window correctly", () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.tryAcquire()).toBe(true); // t=0
    vi.advanceTimersByTime(500);
    expect(limiter.tryAcquire()).toBe(true); // t=500
    expect(limiter.tryAcquire()).toBe(false); // t=500, full

    vi.advanceTimersByTime(501); // t=1001, first request expired
    expect(limiter.tryAcquire()).toBe(true); // allowed again
  });
});
