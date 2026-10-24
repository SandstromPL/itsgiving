import { z } from "zod";

// Structured-output support differs per provider, so the zod schema is
// exported once and each provider keeps only the keywords it understands.
// zod validates the reply afterwards either way.

type JsonSchema = Record<string, unknown>;

/** Keywords both Gemini (responseJsonSchema) and Groq (strict json_schema) accept. */
export const BASE_KEYWORDS = [
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "description",
  "anyOf",
] as const;

/** Gemini also enforces array and number bounds. */
export const GEMINI_KEYWORDS = [...BASE_KEYWORDS, "minItems", "maxItems", "minimum", "maximum"] as const;

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  delete json.$schema;
  return json;
}

export function sanitizeSchema(node: unknown, keep: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((child) => sanitizeSchema(child, keep));
  if (node === null || typeof node !== "object") return node;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (!keep.includes(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      // Property names are data, not keywords: keep every one.
      out.properties = Object.fromEntries(
        Object.entries(value as JsonSchema).map(([name, child]) => [name, sanitizeSchema(child, keep)]),
      );
    } else {
      out[key] = sanitizeSchema(value, keep);
    }
  }
  return out;
}

/**
 * Groq strict mode requires every object to list all its properties as
 * required and to forbid additional ones. Returns the paths that break it.
 */
export function strictModeViolations(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((child, i) => strictModeViolations(child, `${path}[${i}]`));
  if (node === null || typeof node !== "object") return [];
  const schema = node as JsonSchema;
  const problems: string[] = [];
  if (schema.type === "object") {
    const properties = Object.keys((schema.properties as JsonSchema | undefined) ?? {});
    const required = new Set((schema.required as string[] | undefined) ?? []);
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    for (const name of properties) if (!required.has(name)) problems.push(`${path}.${name}: must be required`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, child] of Object.entries(value as JsonSchema)) problems.push(...strictModeViolations(child, `${path}.${name}`));
    } else if (typeof value === "object") {
      problems.push(...strictModeViolations(value, `${path}.${key}`));
    }
  }
  return problems;
}
