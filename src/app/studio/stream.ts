import type { BriefInput } from "@/lib/agent/brief";
import type { AgentEvent } from "@/lib/agent/types";

/**
 * POST the brief and read the server-sent events. EventSource only does GET,
 * so this parses the text/event-stream framing from fetch's body by hand.
 */
export async function streamTreatment(
  brief: BriefInput,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/treatment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(brief),
    signal,
  });
  if (!response.ok || !response.body) {
    let message = `The server answered ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AgentEvent);
      boundary = buffer.indexOf("\n\n");
    }
  }
}
