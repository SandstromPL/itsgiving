import type { QlooCache } from "./cache";
import { QlooError, classifyStatus } from "./errors";
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
  sleep?: (ms: number) => Promise<void>;
  sinks?: ((provenance: Provenance) => void)[];
}

interface GetOptions {
  /** /search documents 404 as "No results"; treat it as an empty list. */
  emptyOn404?: boolean;
}

const MAX_BODY_CHARS = 5 * 1024 * 1024;
const MAX_DELAY_MS = 30_000;

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt + Math.random() * 100, MAX_DELAY_MS);
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
    const parsed = JSON.parse(body) as { error?: { reason?: string; message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.reason ?? parsed.error?.message;
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

  /** A client that also reports every request, cache hits included, to `sink`. */
  recording(sink: (provenance: Provenance) => void): QlooClient {
    return new QlooClient({ ...this.options, sinks: [...(this.options.sinks ?? []), sink] });
  }

  async get<T>(path: string, params: QlooParams = {}, options: GetOptions = {}): Promise<QlooResult<T>> {
    const query = serializeParams(params);
    const warnings = path === "/v2/insights" ? validateInsightsParams(query) : [];
    const key = `${this.mode}:${cacheKey(path, query)}`;
    const cache = this.options.cache;
    const started = Date.now();

    const hit = cache ? await cache.get(key) : undefined;
    if (hit !== undefined) {
      return this.report({
        data: hit as T,
        warnings,
        provenance: { method: "GET", path, query, status: 200, durationMs: 0, cached: true, mode: this.mode },
      });
    }

    const { data, status, requestId } = await this.fetchWithRetry(path, query, options);
    if (cache) await cache.set(key, data);
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

  info() {
    return this.get<ApiInfoResponse>("/");
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
  ): Promise<{ data: unknown; status: number; requestId?: string }> {
    if (this.mode === "live" && !this.options.apiKey) {
      throw new QlooError({ kind: "config", message: "QLOO_API_KEY is not set.", path });
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const search = new URLSearchParams(query).toString();
    const url = `${this.baseUrl}${path}${search ? `?${search}` : ""}`;
    const maxAttempts = this.options.maxAttempts ?? 3;
    const sleep = this.options.sleep ?? defaultSleep;

    let lastError: QlooError | undefined;
    let delay = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(delay);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: this.headers(),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
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
      // Qloo sometimes sends JSON error bodies as text/plain, so always read text.
      const body = await response.text();

      if (response.ok) {
        if (body.length > MAX_BODY_CHARS) {
          throw new QlooError({ kind: "parse", message: `Qloo ${path} response exceeded 5 MiB.`, path, requestId });
        }
        try {
          return { data: body ? JSON.parse(body) : {}, status: response.status, requestId };
        } catch {
          throw new QlooError({ kind: "parse", message: `Qloo ${path} returned invalid JSON.`, path, requestId });
        }
      }

      if (response.status === 404 && options.emptyOn404) {
        return { data: { results: [] }, status: 404, requestId };
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
      delay = retryAfterMs(response.headers.get("retry-after")) ?? backoffMs(attempt);
    }
    throw lastError ?? new QlooError({ kind: "network", message: `Qloo ${path} failed.`, path });
  }
}
