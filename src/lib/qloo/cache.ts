import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Qloo allows private server-side caching with no time limit, but cached
// responses must never be committed to the public repo (QLOO_CACHE_DIR is
// gitignored under /.cache/).

export interface QlooCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryCache implements QlooCache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>();

  constructor(
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly maxEntries = 500,
  ) {}

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency so the Map's insertion order works as an LRU.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
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
