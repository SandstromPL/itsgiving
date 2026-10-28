// The one in-process cache: Qloo responses (qloo/cache.ts), finished treatments (agent/service.ts) and the health
// check's last Qloo call all keep their answers in it, so they share one rule for when an answer is too old.

/**
 * A least-recently-used cache whose entries also expire: an entry set at time t is gone from t + ttlMs on (at
 * `now() >= expiresAt`, never one tick later). Map iteration order doubles as recency order, least recently used first.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    /** Read at each call rather than captured, so tests' fake timers apply to a cache made before they started. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The value for `key`, which becomes the most recently used; undefined when there's none or it has expired. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (this.now() >= entry.expiresAt) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Keeps `value` for ttlMs from now, as the most recently used, evicting the least recently used past `max`. */
  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
