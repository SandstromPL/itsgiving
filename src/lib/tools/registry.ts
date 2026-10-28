import { z } from "zod";
import { QlooError, type Provenance } from "../qloo";
import { audienceHeatmap } from "./heatmap";
import { importExternalIds, resolveEntities } from "./resolve";
import { findTags, readAudience, scoreForAudience, tasteOverlap } from "./taste";
import { castingReferences, referenceFilms, scoutLocations, stylingBrands } from "./treatment";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const TOOLS: readonly AgentTool[] = [
  resolveEntities,
  importExternalIds,
  findTags,
  readAudience,
  tasteOverlap,
  scoreForAudience,
  audienceHeatmap,
  referenceFilms,
  castingReferences,
  stylingBrands,
  scoutLocations,
];

export function getTool(name: string): AgentTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** JSON Schema tool definitions in the {name, description, input_schema} shape LLM APIs expect. */
export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map((tool) => {
    const schema = z.toJSONSchema(tool.inputSchema, { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: tool.name, description: tool.description, input_schema: schema };
  });
}

/** Validate input, run the tool and wrap the outcome; never throws for expected failures. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const provenance: Provenance[] = [];
  const base = { tool: name, provenance, mode: ctx.qloo.mode };
  const tool = getTool(name);
  if (!tool) {
    return {
      ...base,
      status: "error",
      summary: `Unknown tool "${name}".`,
      data: null,
      warnings: [],
      error: { kind: "unknown_tool", message: `Unknown tool "${name}".`, retryable: false },
    };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = z.prettifyError(parsed.error);
    return {
      ...base,
      status: "error",
      summary: `Invalid input for ${name}: ${message}`,
      data: null,
      warnings: [],
      error: { kind: "invalid_input", message, retryable: false },
    };
  }

  try {
    const output = await tool.run(parsed.data, { qloo: ctx.qloo.recording((p) => provenance.push(p), ctx.signal) });
    return {
      ...base,
      status: output.status,
      summary: output.summary,
      data: output.data,
      warnings: [...new Set(output.warnings ?? [])],
    };
  } catch (err) {
    if (err instanceof QlooError) {
      return {
        ...base,
        status: "error",
        summary: `Qloo request failed: ${err.message}`,
        data: null,
        warnings: [],
        error: { kind: err.kind, message: err.message, retryable: err.retryable, hint: err.hint },
      };
    }
    throw err;
  }
}
