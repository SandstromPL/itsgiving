import { z } from "zod";
import { briefSchema, normalizeBrief } from "@/lib/agent/brief";
import { clientIp } from "@/lib/agent/guards";
import { cachedTreatment, getTreatmentService, sseFrame, streamTreatment } from "@/lib/agent/service";
import { readJson, tooMany } from "@/lib/http";

// Plan + write LLM calls and ~25 Qloo requests. A deep-thinking run gives up at 135 s (TIMING in
// pipeline.ts), so this leaves room to close the stream; Vercel allows up to 300 s with Fluid compute.
export const maxDuration = 165;

const MAX_BODY_BYTES = 8 * 1024;

/** Builds a treatment from a brief and streams progress as server-sent events. */
export async function POST(request: Request) {
  const parsed = await readJson(request, briefSchema, {
    tooLarge: { length: MAX_BODY_BYTES, message: "The brief is too large." },
    invalid: z.prettifyError,
  });
  if (parsed instanceof Response) return parsed;
  const brief = normalizeBrief(parsed);

  const service = getTreatmentService();
  if (!cachedTreatment(brief, service)) {
    const limit = service.limiter.check(clientIp(request.headers));
    if (!limit.ok) return tooMany("treatments", limit.retryAfterMs);
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
