import type { z } from "zod";
import type { Provenance, QlooClient, QlooMode } from "../qloo";

export type ToolStatus = "ok" | "empty" | "needs_input" | "error";

/** What every Mise tool returns, to the agent and to the UI alike. */
export interface ToolResult<T = unknown> {
  tool: string;
  status: ToolStatus;
  /** One line the agent can read before deciding what to do next. */
  summary: string;
  data: T | null;
  warnings: string[];
  /** Every Qloo request behind this result, for the "show your work" panel. */
  provenance: Provenance[];
  mode: QlooMode;
  error?: { kind: string; message: string; retryable: boolean; hint?: string };
}

export interface ToolContext {
  qloo: QlooClient;
}

export interface ToolOutput<T> {
  status: Exclude<ToolStatus, "error">;
  summary: string;
  data: T;
  warnings?: string[];
}

/**
 * Provider-neutral tool definition: the zod schema validates input at run
 * time and exports to JSON Schema for whichever LLM API calls the tools.
 */
export interface MiseTool<S extends z.ZodType = z.ZodType, T = unknown> {
  name: string;
  description: string;
  inputSchema: S;
  /** A valid input against the mock catalog, used by the playground and tests. */
  example: z.input<S>;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutput<T>>;
}
