import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// A seal on every treatment the server sends: an HMAC of its JSON. Saving checks it, so the only treatments that can
// be kept, and shared on a page of ours, are ones this server built; nobody can post their own text or pictures to
// the save route and get an itsgiving page for it. The key is drawn from the Supabase secret key (accounts need it
// anyway) through a label, so the two are never the same key.

const LABEL = "itsgiving/treatment-seal/v1";

function sealKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(LABEL).digest();
}

/** A treatment's seal. JSON.stringify gives the same text the browser parses and later sends back. */
export function sealOf(treatment: unknown, secret: string): string {
  return createHmac("sha256", sealKey(secret)).update(JSON.stringify(treatment)).digest("base64url");
}

/** Whether `seal` is this treatment's, compared in constant time. */
export function sealHolds(treatment: unknown, seal: unknown, secret: string): boolean {
  if (typeof seal !== "string") return false;
  const want = Buffer.from(sealOf(treatment, secret));
  const got = Buffer.from(seal);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The service's sealer, or none when accounts aren't set up (no secret key), and then nothing can be saved. */
export function sealerFromEnv(env: Record<string, string | undefined> = process.env): ((treatment: unknown) => string) | undefined {
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  return secret ? (treatment) => sealOf(treatment, secret) : undefined;
}
