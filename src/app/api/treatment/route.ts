import { z } from "zod";
import { briefSchema, normalizeBrief } from "@/lib/agent/brief";
import { clientIp } from "@/lib/agent/guards";
import { cachedTreatment, getTreatmentService, sseFrame, streamTreatment } from "@/lib/agent/service";

// Plan + write LLM calls and ~15 Qloo requests. A deep-thinking run gives up at 120 s (TIMING in
// pipeline.ts), so this leaves room to close the stream; Vercel allows up to 300 s with Fluid compute.
export const maxDuration = 150;

const MAX_BODY_BYTES = 8 * 1024;

function problem(status: number, error: string, headers?: Record<string, string>) {
  return Response.json({ error }, { status, headers });
}

/** Builds a treatment from a brief and streams progress as server-sent events. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return problem(413, "The brief is too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return problem(400, "The request body must be JSON.");
  }
  const parsed = briefSchema.safeParse(body);
  if (!parsed.success) return problem(400, z.prettifyError(parsed.error));
  const brief = normalizeBrief(parsed.data);

  const service = getTreatmentService();
  if (!cachedTreatment(brief, service)) {
    const limit = service.limiter.check(clientIp(request.headers));
    if (!limit.ok) {
      const seconds = Math.ceil(limit.retryAfterMs / 1000);
      return problem(429, `Too many treatments at once. Try again in ${seconds} s.`, { "retry-after": String(seconds) });
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: Parameters<typeof sseFrame>[0]) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event)));
        } catch {
          open = false;
        }
      };
      await streamTreatment(brief, service, emit, abort.signal);
      if (open) controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
