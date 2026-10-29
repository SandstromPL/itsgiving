import type { FetchLike } from "./client";
import type { CompactEntity } from "./normalize";

// Qloo lists a picture on some records that its image server no longer has: images.qloo.com answers those with a 307 to
// its placeholder, /s/oops.png, a blank square 30 px wide (live, 2026-10-29: 4 of the 80 pictures on the featured
// boards, all of them people's). A browser would show the blank, so where a missing picture matters, ask first.

/** The entities whose picture Qloo's image server no longer has, by ID. A picture that can't be asked about stays. */
export async function missingPictures(
  entities: CompactEntity[],
  { fetch: fetchImpl = fetch, signal }: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<Set<string>> {
  const missing = new Set<string>();
  await Promise.all(
    entities.map(async (entity) => {
      if (!entity.image?.startsWith("https://")) return;
      const timeout = AbortSignal.timeout(3_000);
      try {
        const response = await fetchImpl(entity.image, {
          redirect: "manual",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        await response.body?.cancel();
        const placeholder = /\/oops\.png$/.test(response.headers.get("location") ?? "");
        if (placeholder || response.status === 404 || response.status === 410) missing.add(entity.id);
      } catch {
        // Not known to be gone: the browser tries it, and shows the name if it fails.
      }
    }),
  );
  return missing;
}
