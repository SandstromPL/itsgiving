import { connection } from "next/server";
import { QlooError, getQlooClient } from "@/lib/qloo";

/** Makes a real Qloo call: a stored key is not proof the key and host work. */
export async function GET() {
  await connection();
  const qloo = getQlooClient();
  try {
    const result = await qloo.info();
    return Response.json({ ok: true, mode: qloo.mode, baseUrl: qloo.baseUrl, provenance: result.provenance });
  } catch (err) {
    if (!(err instanceof QlooError)) throw err;
    return Response.json(
      {
        ok: false,
        mode: qloo.mode,
        baseUrl: qloo.baseUrl,
        error: { kind: err.kind, status: err.status, message: err.message, hint: err.hint },
      },
      { status: 503 },
    );
  }
}
