/** Fixed one minute windows, per person. In memory: good enough for a single instance, and a restart only forgives a minute. */
export class RateLimiter {
  private windows = new Map<string, { start: number; n: number }>();
  constructor(private now: () => number = Date.now) {}

  /** Count one use. Returns false when the limit for this minute is already spent. */
  take(key: string, max: number): boolean {
    const t = this.now();
    if (this.windows.size > 5000) for (const [k, w] of this.windows) if (t - w.start >= 60_000) this.windows.delete(k);
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(key, { start: t, n: 1 });
      return true;
    }
    if (w.n >= max) return false;
    w.n++;
    return true;
  }
}
