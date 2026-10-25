import { connection } from "next/server";
import { getLlm } from "@/lib/llm";
import { QlooError, getQlooClient } from "@/lib/qloo";

/**
 * Makes a real Qloo call: a stored key is not proof the key and host work.
 * The LLM chain is only described, never called, so health checks spend no model quota or credit.
 */
export async function GET() {
  await connection();
  const qloo = getQlooClient();
  const llmDeps = getLlm();
  const llm = {
    mode: llmDeps.mode,
    chain: [...llmDeps.providers.map((p) => `${p.kind}:${p.model}`), "mock:itsgiving-template"],
    dailyCallsLeft: llmDeps.budget.remaining(),
  };
  try {
    const result = await qloo.info();
    return Response.json({ ok: true, mode: qloo.mode, baseUrl: qloo.baseUrl, provenance: result.provenance, llm });
  } catch (err) {
    if (!(err instanceof QlooError)) throw err;
    return Response.json(
      {
        ok: false,
        mode: qloo.mode,
        baseUrl: qloo.baseUrl,
        error: { kind: err.kind, status: err.status, message: err.message, hint: err.hint },
        llm,
      },
      { status: 503 },
    );
  }
}
