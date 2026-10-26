import type { Treatment } from "./types";

/**
 * A treatment as browsers get it, and as it's saved and shared: without the models' raw error text
 * (attempts[].message), which only the server log needs (validationProblems in service.ts), no page shows, and which
 * can carry details of a provider account. JSON leaves the emptied field out altogether.
 */
export function forBrowser(treatment: Treatment): Treatment {
  return {
    ...treatment,
    llm: treatment.llm.map((trace) => ({ ...trace, attempts: trace.attempts.map((attempt) => ({ ...attempt, message: undefined })) })),
  };
}
