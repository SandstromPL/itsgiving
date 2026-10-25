import type { QlooCache } from "./cache";
import { QlooError, classifyStatus } from "./errors";
import type { Pacer } from "./pacer";
import { cacheKey, serializeParams, validateInsightsParams } from "./params";
import type {
  ApiInfoResponse,
  AudiencesResponse,
  CompareResponse,
  EntityListResponse,
  InsightsResponse,
  QlooParams,
  TagsResponse,
  TrendingResponse,
} from "./types";

/** Hackathon keys only work here; api.qloo.com and staging return 401 for them. */
export const HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

export type QlooMode = "live" | "mock";

/** One Qloo request as shown to users and judges ("which call produced this?"). */
export interface Provenance {
  method: "GET";
  path: string;
  query: Record<string, string>;
  status: number;
  durationMs: number;
  requestId?: string;
  cached: boolean;
  mode: QlooMode;
}

export interface QlooResult<T> {
  data: T;
  provenance: Provenance;
  /** Client-side checks, e.g. a parameter Qloo would silently ignore. */
  warnings: string[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface QlooClientOptions {
  mode: QlooMode;
  apiKey?: string;
  baseUrl?: string;
  /** Defaults to global fetch; mock mode passes the fake Qloo server here. */
  fetch?: FetchLike;
  cache?: QlooCache | null;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Shared by every client on one key, so parallel calls queue under Qloo's per-second limit instead of drawing 429s. */
  pacer?: Pacer;
  sinks?: ((provenance: Provenance) => void)[];
  /** Aborts in-flight requests and pending retries, e.g. when the treatment run times out. */
  signal?: AbortSignal;
}

interface GetOptions {
  /** /search documents 404 as "No results"; treat it as an empty list. */
  emptyOn404?: boolean;
  /** Skip the response cache, e.g. for a health check that must prove the key works now. */
  noCache?: boolean;
}

const MAX_BODY_CHARS = 5 * 1024 * 1024;
/**
 * Larger responses skip the cache. A city heatmap runs to 0.3-1 MB of text (thousands of cells), several
 * MB once parsed, and the in-memory cache holds 500 entries; the heatmap call itself takes under a second.
 */
const MAX_CACHED_CHARS = 256 * 1024;
const MAX_DELAY_MS = 30_000;

/** Waits `ms`, or rejects as soon as `signal` aborts so a cancelled run doesn't sit out a Retry-After. */
export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt + Math.random() * 100, MAX_DELAY_MS);
}

/**
 * Qloo's 429 carries no Retry-After, only x-second-ratelimit-reset: the seconds left in its one-second window. Retrying
 * a little after that (a full second when it's missing) keeps the retry out of the window that refused it.
 */
function rateLimitWaitMs(reset: string | null): number {
  const seconds = reset?.trim() ? Number(reset) : Number.NaN;
  const windowLeftMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000;
  return Math.min(windowLeftMs + 100 + Math.random() * 150, MAX_DELAY_MS);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_DELAY_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), MAX_DELAY_MS);
}

function errorReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { reason?: string; message?: string } | string; error_msg?: string };
    if (typeof parsed.error === "string") return parsed.error;
    // A 429 says {"error_msg": "Rate limit exceeded"}.
    return parsed.error?.reason ?? parsed.error?.message ?? parsed.error_msg;
  } catch {
    return body.trim().slice(0, 200) || undefined;
  }
}

export class QlooClient {
  readonly mode: QlooMode;
  readonly baseUrl: string;
  private readonly options: QlooClientOptions;

  constructor(options: QlooClientOptions) {
    this.options = options;
    this.mode = options.mode;
    this.baseUrl = (options.baseUrl ?? HACKATHON_BASE_URL).replace(/\/+$/, "");
  }

  /** A client that also reports every request, cache hits included, to `sink`, and stops when `signal` aborts. */
  recording(sink: (provenance: Provenance) => void, signal?: AbortSignal): QlooClient {
    return new QlooClient({ ...this.options, sinks: [...(this.options.sinks ?? []), sink], signal: signal ?? this.options.signal });
  }

  async get<T>(path: string, params: QlooParams = {}, options: GetOptions = {}): Promise<QlooResult<T>> {
    const query = serializeParams(params);
    const warnings = path === "/v2/insights" ? validateInsightsParams(query) : [];
    const key = `${this.mode}:${cacheKey(path, query)}`;
    const cache = options.noCache ? null : this.options.cache;
    const started = Date.now();

    const hit = cache ? await cache.get(key) : undefined;
    if (hit !== undefined) {
      return this.report({
        data: hit as T,
        warnings,
        provenance: { method: "GET", path, query, status: 200, durationMs: 0, cached: true, mode: this.mode },
      });
    }

    const { data, status, requestId, chars } = await this.fetchWithRetry(path, query, options);
    if (cache && chars <= MAX_CACHED_CHARS) {
      // Best effort: a read-only disk (QLOO_CACHE_DIR on a serverless host) must not fail a good response.
      await cache.set(key, data).catch((err: unknown) => console.warn(`Qloo cache write failed for ${path}:`, err));
    }
    return this.report({
      data: data as T,
      warnings,
      provenance: {
        method: "GET",
        path,
        query,
        status,
        durationMs: Date.now() - started,
        requestId,
        cached: false,
        mode: this.mode,
      },
    });
  }

  /** Uncached: the health check must prove the key and host work right now. */
  info() {
    return this.get<ApiInfoResponse>("/", {}, { noCache: true });
  }

  search(params: QlooParams) {
    return this.get<EntityListResponse>("/search", params, { emptyOn404: true });
  }

  entities(params: QlooParams) {
    return this.get<EntityListResponse>("/entities", params);
  }

  insights(params: QlooParams) {
    return this.get<InsightsResponse>("/v2/insights", params);
  }

  tags(params: QlooParams) {
    return this.get<TagsResponse>("/v2/tags", params);
  }

  tagTypes(params: QlooParams = {}) {
    return this.get<unknown>("/v2/tags/types", params);
  }

  audiences(params: QlooParams) {
    return this.get<AudiencesResponse>("/v2/audiences", params);
  }

  audienceTypes(params: QlooParams = {}) {
    return this.get<unknown>("/v2/audiences/types", params);
  }

  compare(params: QlooParams) {
    return this.get<CompareResponse>("/v2/analysis/compare", params);
  }

  trending(params: QlooParams) {
    return this.get<TrendingResponse>("/v2/trending", params);
  }

  private report<T>(result: QlooResult<T>): QlooResult<T> {
    for (const sink of this.options.sinks ?? []) sink(result.provenance);
    return result;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.mode === "live" && this.options.apiKey) headers["X-Api-Key"] = this.options.apiKey;
    return headers;
  }

  private async fetchWithRetry(
    path: string,
    query: Record<string, string>,
    options: GetOptions,
  ): Promise<{ data: unknown; status: number; requestId?: string; chars: number }> {
    if (this.mode === "live" && !this.options.apiKey) {
      throw new QlooError({ kind: "config", message: "QLOO_API_KEY is not set.", path });
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const search = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${search ? `?${search}` : ""}`;
    const maxAttempts = this.options.maxAttempts ?? 3;
    const sleep = this.options.sleep ?? defaultSleep;
    const outer = this.options.signal;

    let lastError: QlooError | undefined;
    let delay = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // An aborted run (client gone, or the run's deadline) stops here instead of retrying: rethrow its reason.
      outer?.throwIfAborted();
      if (attempt > 0) await (outer ? sleep(delay, outer) : sleep(delay));
      // Retries queue too: Qloo counts every call against the key's per-second limit.
      const turn = this.options.pacer?.reserve() ?? 0;
      if (turn > 0) await (outer ? sleep(turn, outer) : sleep(turn));

      let response: Response;
      let body: string;
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20_000);
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: this.headers(),
          signal: outer ? AbortSignal.any([outer, timeout]) : timeout,
        });
        // Qloo sometimes sends JSON error bodies as text/plain, so always read text. The body can fail
        // mid-stream too (reset, timeout), so it is read inside the same retry guard as the request.
        body = await response.text();
      } catch (err) {
        outer?.throwIfAborted();
        const timedOut = timeout.aborted || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
        lastError = new QlooError({
          kind: timedOut ? "timeout" : "network",
          message: `Qloo ${path} ${timedOut ? "timed out" : "request failed"}: ${err instanceof Error ? err.message : String(err)}`,
          path,
          retryable: true,
        });
        delay = backoffMs(attempt);
        continue;
      }

      const requestId = response.headers.get("x-qloo-request-id") ?? undefined;

      if (response.ok) {
        if (body.length > MAX_BODY_CHARS) {
          throw new QlooError({ kind: "parse", message: `Qloo ${path} response exceeded 5 MiB.`, path, requestId });
        }
        try {
          return { data: body ? JSON.parse(body) : {}, status: response.status, requestId, chars: body.length };
        } catch {
          throw new QlooError({ kind: "parse", message: `Qloo ${path} returned invalid JSON.`, path, requestId });
        }
      }

      if (response.status === 404 && options.emptyOn404) {
        return { data: { results: [] }, status: 404, requestId, chars: 0 };
      }

      const { kind, retryable } = classifyStatus(response.status);
      const reason = errorReason(body);
      lastError = new QlooError({
        kind,
        message: `Qloo ${path} returned ${response.status}${reason ? `: ${reason}` : ""}`,
        path,
        status: response.status,
        reason,
        retryable,
        requestId,
      });
      if (!retryable) throw lastError;
      delay =
        retryAfterMs(response.headers.get("retry-after")) ??
        (response.status === 429 ? rateLimitWaitMs(response.headers.get("x-second-ratelimit-reset")) : backoffMs(attempt));
    }
    throw lastError ?? new QlooError({ kind: "network", message: `Qloo ${path} failed.`, path });
  }
}
