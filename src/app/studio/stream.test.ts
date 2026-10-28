import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefInput } from "@/lib/agent/brief";
import { sseFrame } from "@/lib/agent/service";
import type { AgentEvent } from "@/lib/agent/types";
import { tooMany } from "@/lib/http";
import { StreamError, streamTreatment } from "./stream";

// The browser's reader for the treatment route's server-sent events, fed frames exactly as the server writes them
// (sseFrame), cut into chunks wherever the network might cut them.

const start: AgentEvent = { type: "start", runId: "run-1", qlooMode: "mock", llmMode: "mock", cached: false };
// Curly quotes and an accent are several bytes each in UTF-8, so a cut can fall inside one.
const step: AgentEvent = {
  type: "step",
  id: "resolve",
  status: "done",
  label: "Find the names in Qloo",
  summary: "Found “Bon Iver” and Café Society",
};
const done: AgentEvent = { type: "done" };

const bytes = (text: string) => new TextEncoder().encode(text);

/** Answers the next fetch with an event stream that sends `chunks` one by one, then ends (or fails with `drop`). */
function serve(chunks: Uint8Array[], drop?: Error) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            if (drop) controller.error(drop);
            else controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function read(): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await streamTreatment(
    { artist: "Bon Iver", city: "New York" } as BriefInput,
    (event) => events.push(event),
    new AbortController().signal,
  );
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamTreatment (the browser's reader)", () => {
  it("posts the brief as JSON to the treatment route", async () => {
    const fetchMock = serve([bytes(sseFrame(done))]);
    await read();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/treatment");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(String(init?.body))).toEqual({ artist: "Bon Iver", city: "New York" });
  });

  it("puts an event split across chunks back together, wherever the cut falls, even inside a character", async () => {
    const frame = bytes(sseFrame(step));
    for (let cut = 1; cut < frame.length; cut++) {
      serve([frame.slice(0, cut), frame.slice(cut)]);
      expect(await read(), `cut at byte ${cut}`).toEqual([step]);
    }
    serve([...frame].map((byte) => Uint8Array.of(byte)));
    expect(await read()).toEqual([step]);
  });

  it("reads several events from one chunk, in order", async () => {
    serve([bytes(sseFrame(start) + sseFrame(step) + sseFrame(done))]);
    expect(await read()).toEqual([start, step, done]);
  });

  it("drops an event the stream ends in the middle of, and leaves it to the caller to see nothing finished", async () => {
    const whole = sseFrame(start) + sseFrame(step);
    const cutShort = sseFrame({ type: "error", message: "Something went wrong while building the treatment." });
    // Cut inside the data line, and cut after it but before the blank line that ends the event: neither is dispatched.
    for (const tail of [cutShort.slice(0, 30), cutShort.slice(0, -1)]) {
      serve([bytes(whole), bytes(tail)]);
      await expect(read()).resolves.toEqual([start, step]);
    }
  });

  it("reads frames whose line endings a proxy turned into CRLF, even with a CR and its LF in different chunks", async () => {
    const crlf = (sseFrame(start) + sseFrame(step)).replaceAll("\n", "\r\n");
    for (let cut = 1; cut < crlf.length; cut++) {
      if (crlf[cut - 1] !== "\r") continue;
      serve([bytes(crlf.slice(0, cut)), bytes(crlf.slice(cut))]);
      expect(await read(), `cut after the CR at ${cut}`).toEqual([start, step]);
    }
  });

  it("says what went wrong: the route's own words, a dropped connection, a garbled frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tooMany("treatments", 30_000)),
    );
    const refused = read();
    await expect(refused).rejects.toBeInstanceOf(StreamError);
    await expect(refused).rejects.toMatchObject({ message: "Too many treatments at once. Try again in 30 s." });

    serve([bytes(sseFrame(start))], new TypeError("network error"));
    await expect(read()).rejects.toMatchObject({
      name: "StreamError",
      message: "The connection dropped before the treatment finished. Try again.",
      detail: "TypeError: network error",
    });

    serve([bytes("event: step\ndata: {not json\n\n")]);
    await expect(read()).rejects.toMatchObject({ name: "StreamError", message: "The server sent a garbled update. Try again." });
  });
});
