import { connection } from "next/server";
import { RateLimiter, clientIp } from "@/lib/agent/guards";
import { tooMany } from "@/lib/http";
import { getLlm } from "@/lib/llm";
import { TtlCache } from "@/lib/lru";
import { QlooError, getQlooClient, type Provenance, type QlooClient, type QlooErrorKind } from "@/lib/qloo";

/** Per address: an uptime monitor checks every minute or so, and a person reloading the page stays under this too. */
const limiter = new RateLimiter(10, 60_000);

type QlooCheck =
  { ok: true; provenance: Provenance } | { ok: false; error: { kind: QlooErrorKind; status?: number; message: string; hint?: string } };

/**
 * The last Qloo check, kept five minutes: a monitor polling this route every minute spends at most one Qloo call
 * every five minutes on each server instance (about 8,600 a month), not one per poll (43,000), from the key's 50,000
 * a month. The call itself is kept, so requests that arrive while it runs wait for the same answer instead of each
 * making their own.
 */
const CHECK_MS = 5 * 60_000;
const checks = new TtlCache<Promise<QlooCheck>>(1, CHECK_MS);

async function checkQloo(qloo: QlooClient): Promise<QlooCheck> {
  try {
    const result = await qloo.info();
    return { ok: true, provenance: result.provenance };
  } catch (err) {
    if (!(err instanceof QlooError)) throw err;
    return { ok: false, error: { kind: err.kind, status: err.status, message: err.message, hint: err.hint } };
  }
}

/**
 * Makes a real Qloo call: a stored key is not proof the key and host work.
 * The LLM chain is only described, never called, so health checks spend no model quota or credit.
 */
export async function GET(request: Request) {
  await connection();
  const limit = limiter.check(clientIp(request.headers));
  if (!limit.ok) return tooMany("health checks", limit.retryAfterMs);

  const qloo = getQlooClient();
  const llmDeps = getLlm();
  const llm = {
    mode: llmDeps.mode,
    chain: [...llmDeps.providers.map((p) => `${p.kind}:${p.model}`), "mock:itsgiving-template"],
    dailyCallsLeft: llmDeps.budget.remaining(),
  };
  let check = checks.get("qloo");
  if (!check) {
    check = checkQloo(qloo);
    checks.set("qloo", check);
    // Anything but a QlooError is a fault here, not Qloo's answer: it fails this request as before and isn't kept.
    check.catch(() => checks.delete("qloo"));
  }
  const checked = await check;
  if (checked.ok) return Response.json({ ok: true, mode: qloo.mode, baseUrl: qloo.baseUrl, provenance: checked.provenance, llm });
  return Response.json({ ok: false, mode: qloo.mode, baseUrl: qloo.baseUrl, error: checked.error, llm }, { status: 503 });
}
