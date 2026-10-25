export type QlooErrorKind =
  "config" | "auth" | "forbidden" | "bad_request" | "not_found" | "rate_limit" | "upstream" | "network" | "timeout" | "parse";

const HINTS: Partial<Record<QlooErrorKind, string>> = {
  config: "Set QLOO_API_KEY (and QLOO_BASE_URL) or run with QLOO_MODE=mock.",
  auth: "Check the key and that QLOO_BASE_URL is https://hackathon.api.qloo.com; hackathon keys get 401 on api.qloo.com.",
  forbidden: "Qloo returns 403 for an unsupported filter.type (e.g. urn:entity:music); this is not a key problem.",
  bad_request: "A location/entity name may not have resolved, or a tag/audience was not a real URN.",
  rate_limit: "Rate limited; back off and retry, or ask in Discord #api-help for a higher limit.",
};

export class QlooError extends Error {
  readonly kind: QlooErrorKind;
  readonly status?: number;
  readonly reason?: string;
  readonly retryable: boolean;
  readonly path: string;
  readonly requestId?: string;
  readonly hint?: string;

  constructor(init: {
    kind: QlooErrorKind;
    message: string;
    path: string;
    status?: number;
    reason?: string;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(init.message);
    this.name = "QlooError";
    this.kind = init.kind;
    this.status = init.status;
    this.reason = init.reason;
    this.retryable = init.retryable ?? false;
    this.path = init.path;
    this.requestId = init.requestId;
    this.hint = HINTS[init.kind];
  }
}

export function classifyStatus(status: number): { kind: QlooErrorKind; retryable: boolean } {
  if (status === 401) return { kind: "auth", retryable: false };
  if (status === 403) return { kind: "forbidden", retryable: false };
  if (status === 404) return { kind: "not_found", retryable: false };
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { kind: "upstream", retryable: true };
  }
  if (status >= 500) return { kind: "upstream", retryable: false };
  return { kind: "bad_request", retryable: false };
}
