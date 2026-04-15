/**
 * Simple sliding-window rate limiter for IPC calls.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  tryAcquire(): boolean {
    const now = Date.now();
    // Remove expired timestamps
    this.timestamps = this.timestamps.filter(
      (t) => now - t < this.windowMs,
    );
    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}
