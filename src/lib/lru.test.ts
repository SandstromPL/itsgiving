import { afterEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "./lru";
import { MemoryCache } from "./qloo/cache";

describe("TtlCache", () => {
  it("keeps an entry exactly ttlMs: still there a tick before, gone at the moment it expires", () => {
    let now = 1_000;
    const cache = new TtlCache<string>(10, 100, () => now);
    cache.set("a", "first");
    now = 1_099;
    expect(cache.get("a")).toBe("first");
    now = 1_100;
    expect(cache.get("a")).toBeUndefined();
    now = 1_000; // an expired entry is dropped when read, not hidden: winding the clock back doesn't bring it back
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the least recently used past its size, where reading or setting a key again makes it the most recent", () => {
    const cache = new TtlCache<number>(2, 1_000, () => 0);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3); // "b" was used least recently
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([1, undefined, 3]);
    cache.set("a", 10); // a new value for "a", now the most recent: "c" goes next
    cache.set("d", 4);
    expect([cache.get("a"), cache.get("c"), cache.get("d")]).toEqual([10, undefined, 4]);
  });

  it("restarts an entry's time when it's set again, but not when it's read", () => {
    let now = 0;
    const cache = new TtlCache<string>(10, 100, () => now);
    cache.set("set again", "old");
    cache.set("read", "value");
    now = 90;
    cache.set("set again", "new");
    expect(cache.get("read")).toBe("value");
    now = 150;
    expect(cache.get("set again")).toBe("new");
    expect(cache.get("read")).toBeUndefined();
  });

  it("forgets a deleted key and keeps the rest", () => {
    const cache = new TtlCache<number>(10, 1_000, () => 0);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    cache.delete("missing");
    expect([cache.get("a"), cache.get("b")]).toEqual([undefined, 2]);
  });
});

describe("MemoryCache (Qloo responses)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a response an hour by default, on the clock at each call", async () => {
    const cache = new MemoryCache();
    vi.useFakeTimers({ now: new Date("2026-10-28T00:00:00Z") });
    await cache.set("search?query=Mimi", { results: [] });
    vi.setSystemTime(new Date("2026-10-28T00:59:59.999Z"));
    expect(await cache.get("search?query=Mimi")).toEqual({ results: [] });
    vi.setSystemTime(new Date("2026-10-28T01:00:00Z"));
    expect(await cache.get("search?query=Mimi")).toBeUndefined();
  });

  it("holds 500 responses by default, dropping the least recently used", async () => {
    const cache = new MemoryCache();
    for (let i = 0; i <= 500; i++) await cache.set(`k${i}`, i);
    expect(await cache.get("k0")).toBeUndefined();
    expect(await cache.get("k1")).toBe(1);
    expect(await cache.get("k500")).toBe(500);
  });
});
