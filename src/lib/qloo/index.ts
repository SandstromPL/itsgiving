import { DiskCache, LayeredCache, MemoryCache, type QlooCache } from "./cache";
import { HACKATHON_BASE_URL, QlooClient, type QlooMode } from "./client";
import { createMockFetch } from "./mock/server";
import { Pacer } from "./pacer";

export * from "./client";
export * from "./errors";
export * from "./normalize";
export * from "./urns";
export type * from "./types";

export interface QlooConfig {
  mode: QlooMode;
  apiKey?: string;
  baseUrl: string;
  cacheDir?: string;
}

/**
 * QLOO_MODE wins when set; otherwise run live when a key is present and fall
 * back to the synthetic mock so the app works before the key arrives.
 */
export function qlooConfigFromEnv(env: Record<string, string | undefined> = process.env): QlooConfig {
  const apiKey = env.QLOO_API_KEY?.trim() || undefined;
  const requested = env.QLOO_MODE?.trim().toLowerCase();
  const mode: QlooMode = requested === "mock" || requested === "live" ? requested : apiKey ? "live" : "mock";
  return {
    mode,
    apiKey,
    baseUrl: env.QLOO_BASE_URL?.trim() || HACKATHON_BASE_URL,
    cacheDir: env.QLOO_CACHE_DIR?.trim() || undefined,
  };
}

/**
 * Qloo allows 10 calls a second per key (x-second-ratelimit-limit). Every live client in this process shares one pacer
 * set just under that, so parallel steps and simultaneous treatments queue for a moment instead of drawing 429s. It
 * can't see other processes on the same key, such as a deploy's build running next to the live site.
 */
const livePacer = new Pacer(8, 1000);

export function createQlooClient(config: QlooConfig = qlooConfigFromEnv()): QlooClient {
  const layers: QlooCache[] = [new MemoryCache()];
  if (config.cacheDir) layers.push(new DiskCache(config.cacheDir));
  return new QlooClient({
    mode: config.mode,
    apiKey: config.apiKey,
    // A healthy call takes 0.3-1.5 s; Qloo's own gateway gives up at 60 s (504). Two short attempts keep one
    // bad call from eating the treatment's time limit.
    timeoutMs: 12_000,
    maxAttempts: 2,
    pacer: config.mode === "live" ? livePacer : undefined,
    baseUrl: config.mode === "mock" ? "https://mock.qloo.invalid" : config.baseUrl,
    fetch: config.mode === "mock" ? createMockFetch() : undefined,
    cache: layers.length === 1 ? layers[0] : new LayeredCache(layers),
  });
}

let shared: QlooClient | undefined;

/** Process-wide client so the in-memory cache is shared across requests. */
export function getQlooClient(): QlooClient {
  shared ??= createQlooClient();
  return shared;
}
