import type { Nudge } from "@/lib/agent/options";
import type { StepEvent, Treatment } from "@/lib/agent/types";
import { EMPTY_FORM, type FormState } from "./form";

/** One request's inputs: kept so iterate chips and the picker re-run the brief behind the board, not the live form. */
export interface RunInput {
  form: FormState;
  picks: Record<string, string>;
  nudges: Nudge[];
}

/** The studio as it was left: the brief being written, and the last board with what made it. */
export interface StudioSession {
  form: FormState;
  board: { treatment: Treatment; shown: RunInput; take: number; steps: StepEvent[] } | null;
}

let last: StudioSession = { form: EMPTY_FORM, board: null };

/**
 * Kept in memory for the visit, so leaving the studio (for the homepage or an example) and coming back still has the
 * brief and offers "Back to <title>". Written only in the browser, after a render, never while rendering on the
 * server. A reload starts clean.
 */
export const studioSession = {
  read: (): StudioSession => last,
  write: (session: StudioSession) => {
    last = session;
  },
};
