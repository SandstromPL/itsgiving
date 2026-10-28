// In-process guards for the public treatment endpoint. On serverless hosts
// each instance keeps its own counters, which is acceptable for a demo: they
// exist to stop a burst from draining the free LLM quota, not to meter users.

export class RateLimiter {
  /** Hit times per key; Map order doubles as recency order, least recently seen first. */
  private readonly hits = new Map<string, number[]>();
  private prunedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    /** Keys kept at most, so someone rotating addresses can't grow the map, or the work of a call, past it. */
    private readonly maxKeys = 5_000,
  ) {}

  /** Records a hit for `key` unless it is over the limit. */
  check(key: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    const refused = recent.length >= this.limit;
    if (!refused) recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.trim(now);
    return refused ? { ok: false, retryAfterMs: this.windowMs - (now - recent[0]) } : { ok: true };
  }

  /** Whether `key` is at its limit right now. Counts nothing: for a second look at a request `check` has counted. */
  full(key: string): boolean {
    const now = this.now();
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length >= this.limit;
  }

  /** Drops expired keys (a full pass, at most once a window), then the least recently seen while still over budget. */
  private trim(now: number) {
    if (now - this.prunedAt >= this.windowMs) {
      this.prunedAt = now;
      for (const [key, times] of this.hits) {
        if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
      }
    }
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/** The treatment cache is the server's one LRU with a TTL (lib/lru.ts); the service and its tests take it from here. */
export { TtlCache } from "../lru";

/**
 * The client's address as the rate limits count it, from proxy headers (Vercel sets x-forwarded-for itself): an IPv4
 * address whole, an IPv6 address by its /64, since a home or a server holds a whole /64 and could rotate through it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return addressKey(forwarded || headers.get("x-real-ip")?.trim() || "unknown");
}

function addressKey(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // "::" stands for as many zero groups as it takes to make eight.
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
