import { TOOLS, toolDefinitions } from "@/lib/tools/registry";

/** Tool catalog: the JSON Schemas an LLM sees, plus a mock-valid example for each. */
export async function GET() {
  const examples = new Map(TOOLS.map((tool) => [tool.name, tool.example]));
  return Response.json({
    tools: toolDefinitions().map((definition) => ({ ...definition, example: examples.get(definition.name) })),
  });
}
