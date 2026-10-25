import type { BriefInput } from "@/lib/agent/brief";
import type { AgentEvent } from "@/lib/agent/types";

/** A failure the person can act on, worded for them; `detail` keeps the raw cause for the console. */
export class StreamError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

/**
 * POST the brief and read the server-sent events. EventSource only does GET,
 * so this parses the text/event-stream framing from fetch's body by hand.
 * Resolves when the stream closes; the caller checks that a terminal event
 * (treatment, needs_input or error) arrived before it did.
 */
export async function streamTreatment(
  brief: BriefInput,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/treatment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(brief),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new StreamError("Mise couldn't reach the server. Check your connection and try again.", String(err));
  }

  if (!response.ok || !response.body) {
    let message = `The server answered ${response.status}. Try again in a moment.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON: keep the status message
    }
    throw new StreamError(message);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new StreamError("The server sent an unexpected response. Try again.", response.headers.get("content-type") ?? "no content-type");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal.aborted) throw err;
        throw new StreamError("The connection dropped before the treatment finished. Try again.", String(err));
      }
      if (chunk.done) break;
      // Proxies may rewrite line endings; the SSE spec allows CRLF, CR and LF.
      buffer += chunk.value.replace(/\r\n?/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
          .join("\n");
        if (data) {
          let event: AgentEvent;
          try {
            event = JSON.parse(data) as AgentEvent;
          } catch (err) {
            throw new StreamError("The server sent a garbled update. Try again.", String(err));
          }
          onEvent(event);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
