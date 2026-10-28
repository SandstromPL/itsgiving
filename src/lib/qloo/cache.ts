import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TtlCache } from "../lru";

// Qloo allows private server-side caching with no time limit, but cached
// responses must never be committed to the public repo (QLOO_CACHE_DIR is
// gitignored under /.cache/).

export interface QlooCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** This process's copy of recent responses: an LRU of `maxEntries`, each kept `ttlMs`. */
export class MemoryCache implements QlooCache {
  private readonly entries: TtlCache<unknown>;

  constructor(ttlMs = 60 * 60 * 1000, maxEntries = 500) {
    this.entries = new TtlCache(maxEntries, ttlMs);
  }

  async get(key: string): Promise<unknown | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
  }
}

/** Persists responses as JSON files; meant for local dev and pre-warming demos. */
export class DiskCache implements QlooCache {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    return path.join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  async get(key: string): Promise<unknown | undefined> {
    try {
      const raw = JSON.parse(await readFile(this.file(key), "utf8")) as { value: unknown };
      return raw.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify({ key, value }), "utf8");
  }
}

/** Reads through each layer in order and back-fills the earlier ones on a hit. */
export class LayeredCache implements QlooCache {
  constructor(private readonly layers: QlooCache[]) {}

  async get(key: string): Promise<unknown | undefined> {
    for (let i = 0; i < this.layers.length; i++) {
      const value = await this.layers[i].get(key);
      if (value !== undefined) {
        await Promise.all(this.layers.slice(0, i).map((layer) => layer.set(key, value)));
        return value;
      }
    }
    return undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.set(key, value)));
  }
}
