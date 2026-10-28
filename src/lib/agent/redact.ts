import type { AgentEvent, LlmTrace, Treatment } from "./types";

/** A model step's trace without the models' raw error text: what each attempt came to, not what the provider said. */
const quiet = (trace: LlmTrace): LlmTrace => ({
  ...trace,
  attempts: trace.attempts.map((attempt) => ({ ...attempt, message: undefined })),
});

/**
 * A treatment as browsers get it, and as it's saved and shared: without the models' raw error text
 * (attempts[].message), which only the server log needs (validationProblems in service.ts), no page shows, and which
 * can carry details of a provider account. JSON leaves the emptied field out altogether.
 */
export function forBrowser(treatment: Treatment): Treatment {
  return { ...treatment, llm: treatment.llm.map(quiet) };
}

/** A progress event as browsers get it: a model step's trace rides on its step event, so it loses the same text. */
export function eventForBrowser(event: AgentEvent): AgentEvent {
  return event.type === "step" && event.llm ? { ...event, llm: quiet(event.llm) } : event;
}
