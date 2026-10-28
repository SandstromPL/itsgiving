import { useEffect, useRef } from "react";
import type { BriefInput } from "@/lib/agent/brief";
import type { AgentEvent } from "@/lib/agent/types";
import { StreamError, streamTreatment } from "./stream";

/**
 * The server reports progress at least every few seconds, even while a model thinks (TIMING and TICK_MS
 * in pipeline.ts), so this much silence means the connection is gone.
 */
const STALL_MS = 75_000;

/** The events that end a run: after one of them, a stream that closes is a run that finished. */
const FINAL: AgentEvent["type"][] = ["needs_input", "treatment", "error"];

/**
 * The plumbing of a studio run: one build in flight at a time (a new one aborts the last, whose events then stop
 * counting), a watchdog for a server gone quiet, Stop, and the words for a run that ended badly. What each event
 * means for the studio stays with the studio, in `onEvent`.
 */
export function useRunStream() {
  const active = useRef<AbortController | null>(null);
  const stopActive = useRef<() => void>(() => {});

  // Leaving the page mid-run shouldn't keep spending model quota and credit. Next keeps a page it leaves (hidden, for
  // Back), so this stops the run as Stop does: coming back finds it stopped, not failed.
  useEffect(() => () => stopActive.current(), []);

  const start = async (
    brief: BriefInput,
    onEvent: (event: AgentEvent) => void,
    ended: { fail: (message: string) => void; stopped: () => void },
  ) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    let finished = false;
    let stalled = false;
    let stopped = false;
    stopActive.current = () => {
      stopped = true;
      controller.abort();
    };
    const stall = () => {
      stalled = true;
      controller.abort();
    };
    let watchdog = setTimeout(stall, STALL_MS);

    try {
      await streamTreatment(
        brief,
        (event) => {
          if (active.current !== controller) return; // a newer run has taken over
          clearTimeout(watchdog);
          watchdog = setTimeout(stall, STALL_MS);
          if (FINAL.includes(event.type)) finished = true;
          onEvent(event);
        },
        controller.signal,
      );
      if (active.current === controller && !finished) ended.fail("The connection closed before the treatment finished. Try again.");
    } catch (err) {
      if (active.current !== controller) return;
      if (stopped) {
        ended.stopped();
      } else if (stalled) {
        ended.fail("The server went quiet for over a minute, so itsgiving stopped waiting. Try again.");
      } else {
        if (err instanceof StreamError && err.detail) console.error(err.detail);
        else if (!(err instanceof StreamError)) console.error(err);
        ended.fail(err instanceof StreamError ? err.message : "Something went wrong while building the treatment. Try again.");
      }
    } finally {
      clearTimeout(watchdog);
    }
  };

  return { start, stop: () => stopActive.current() };
}
