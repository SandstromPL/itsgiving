import type { FetchLike } from "../qloo";
import { LlmError, classifyHttpStatus, retryAfterHeader, type LlmErrorKind, type LlmProviderKind } from "./types";

// The HTTP side every provider shares: POST the request as JSON, read the reply as text (a refusal isn't always
// JSON), and turn a refusal into the LlmError the chain acts on (fall through, rest the provider, honour its wait).

/** Makes a provider's errors, each message led by its name and model: "DeepSeek deepseek-flash: HTTP 402: …". */
export type Fail = (kind: LlmErrorKind, message: string, status?: number, retryAfterMs?: number) => LlmError;

export function failFor(name: string, provider: LlmProviderKind, model: string): Fail {
  return (kind, message, status, retryAfterMs) =>
    new LlmError({ kind, message: `${name} ${model}: ${message}`, provider, model, status, retryAfterMs });
}

export interface PostJson<T> {
  url: string;
  /** The key's header; the content type is added here. */
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  /** Defaults to the global fetch, looked up at call time. */
  fetch?: FetchLike;
  fail: Fail;
  /** A refusal's kind when the status alone doesn't tell it; classifyHttpStatus otherwise. */
  kind?: (status: number, reply: T, reason: string) => LlmErrorKind;
  /** How long a refusal asks us to wait, when the provider says it somewhere other than Retry-After. */
  retryAfterMs?: (reply: T, headers: Headers) => number | undefined;
}

/**
 * The provider's reply, parsed ({} when empty). A refusal throws with its status, its reason (the reply's
 * error.message, else the start of its text) and the wait it asked for; a success that isn't JSON throws "upstream".
 */
export async function postJson<T extends { error?: { message?: string } }>(request: PostJson<T>): Promise<T> {
  const response = await (request.fetch ?? fetch)(request.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...request.headers },
    body: JSON.stringify(request.body),
    signal: request.signal,
  });
  const raw = await response.text();
  let reply = {} as T;
  try {
    reply = raw ? (JSON.parse(raw) as T) : reply;
  } catch {
    if (response.ok) throw request.fail("upstream", "returned invalid JSON", response.status);
  }
  if (!response.ok) {
    const reason = reply.error?.message ?? raw.slice(0, 200);
    throw request.fail(
      request.kind ? request.kind(response.status, reply, reason) : classifyHttpStatus(response.status),
      `HTTP ${response.status}${reason ? `: ${reason}` : ""}`,
      response.status,
      request.retryAfterMs ? request.retryAfterMs(reply, response.headers) : retryAfterHeader(response.headers.get("retry-after")),
    );
  }
  return reply;
}
