import type { Cache } from '../application/ports';

/**
 * Per-process cache for upstream responses (seconds-long TTLs). It only spares the exchange from
 * duplicate requests; nothing authoritative lives here. Failed loads are not cached.
 */
export class MemoryCache implements Cache {
  private entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 2000) {}

  getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { expires: this.now() + ttlMs, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    if (this.entries.size > this.maxEntries) this.evictExpired();
    return value;
  }

  private evictExpired() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
    // Still too many: drop the oldest insertions.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
