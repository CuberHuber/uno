/** Fixed-window in-memory rate limiter — sound while the server is a single
 *  instance. The clock is injectable for tests. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}
  blocked(key: string): boolean {
    const w = this.windows.get(key);
    return !!w && this.now() - w.start < this.windowMs && w.count >= this.max;
  }
  hit(key: string): void {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) this.windows.set(key, { start: t, count: 1 });
    else w.count += 1;
  }
  allow(key: string): boolean {
    if (this.blocked(key)) return false;
    this.hit(key);
    return true;
  }
  sweep(): void {
    const t = this.now();
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
