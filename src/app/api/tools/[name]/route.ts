import { toolPlaygroundEnabled } from "@/lib/env";
import { getQlooClient } from "@/lib/qloo";
import { runTool } from "@/lib/tools/registry";

export async function POST(request: Request, ctx: RouteContext<"/api/tools/[name]">) {
  if (!toolPlaygroundEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { name } = await ctx.params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const result = await runTool(name, input, { qloo: getQlooClient() });
  const status =
    result.error?.kind === "unknown_tool" ? 404 : result.error?.kind === "invalid_input" ? 400 : result.status === "error" ? 502 : 200;
  return Response.json(result, { status });
}
