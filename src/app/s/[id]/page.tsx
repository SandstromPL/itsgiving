import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { ModeBadges } from "@/app/studio/parts";
import { SiteHeader } from "@/app/studio/site-header";
import { RateLimiter, clientIp } from "@/lib/agent/guards";
import { SavedStoreError, savedForViewer } from "@/lib/saved/store";
import { viewerId } from "@/lib/supabase/server";
import { SavedBoard, SavedMissing } from "./saved-board";

// A saved treatment's page: its owner's always, anyone's while it's shared. Read at request time (it depends on who's
// asking), behind Suspense, so the shell streams first. A private, deleted or unknown treatment gets the same answer,
// and no page here is ever indexed: a share link is for whoever it's given to.

/**
 * Saved treatments one address may open a minute: far more than anyone reads, too few for a script to run up the free
 * database's quota. The page counts each view where it reads the database, so the router's prefetches of a list (they
 * fetch only the page's shell) never count. Its title only looks: Next can work the title out in a render of its own,
 * where counting again would halve the limit. (The dev server renders each view twice to check it, so there the limit
 * comes at 30.) Per server instance, like the site's other limits; IPv6 counts by its /64 (see clientIp).
 */
const opens = new RateLimiter(60, 60_000);

/** The visitor's address, for the limit. Request time only: the limit reads the clock, which a prerender may not. */
async function address() {
  await connection();
  return clientIp(await headers());
}

/** Who's asking and what they may see, read once per request for both the page and its metadata. */
const lookup = cache(async (id: string) => {
  const viewer = await viewerId();
  try {
    return { viewer, item: await savedForViewer(id, viewer) };
  } catch (err) {
    if (err instanceof SavedStoreError) {
      console.error(JSON.stringify({ evt: "saved", action: "read", outcome: "unavailable", error: err.message }));
      return { viewer, item: "unavailable" as const };
    }
    throw err;
  }
});

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const robots = { index: false, follow: false };
  if (opens.full(await address())) return { title: "Try again in a minute: itsgiving", robots };
  const { id } = await params;
  const { item } = await lookup(id);
  const found = item && item !== "unavailable" ? item : null;
  return { title: found ? `${found.title}: itsgiving` : "Page not found: itsgiving", description: found?.treatment.logline, robots };
}

export default function SavedPage({ params }: PageProps<"/s/[id]">) {
  return (
    <Suspense
      fallback={
        <>
          <SiteHeader />
          <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-8 px-4 pt-8 pb-16 sm:px-8 sm:pt-10">
            <div aria-hidden className="surface-dark min-h-[32rem] rounded-[2rem] bg-background sm:min-h-[36rem]" />
            <p role="status" className="sr-only">
              Opening the treatment…
            </p>
          </main>
        </>
      }
    >
      <Saved params={params} />
    </Suspense>
  );
}

async function Saved({ params }: { params: PageProps<"/s/[id]">["params"] }) {
  const { id } = await params;
  const limit = opens.check(await address());
  const { item, viewer } = limit.ok ? await lookup(id) : { item: null, viewer: null };
  if (!item || item === "unavailable") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col justify-center gap-6 px-4 py-24 sm:px-8">
          {!limit.ok ? (
            <>
              <h1 className="type-poster max-w-[16ch] text-[clamp(3rem,7vw,6rem)]">give it a minute</h1>
              <p role="alert" className="max-w-[46ch] text-[1.2rem] leading-[1.45] text-dim">
                Too many saved treatments were opened from your connection in the last minute. Try again in{" "}
                {Math.ceil(limit.retryAfterMs / 1000)} seconds.
              </p>
            </>
          ) : item === "unavailable" ? (
            <>
              <h1 className="type-poster max-w-[16ch] text-[clamp(3rem,7vw,6rem)]">saved treatments are offline</h1>
              <p role="alert" className="max-w-[46ch] text-[1.2rem] leading-[1.45] text-dim">
                The database didn&apos;t answer. Try again in a minute; building a new treatment still works.
              </p>
            </>
          ) : (
            <SavedMissing />
          )}
        </main>
      </>
    );
  }
  const t = item.treatment;
  return (
    <>
      <SiteHeader badges={<ModeBadges qloo={t.mock.qloo ? "mock" : "live"} llm={t.writtenBy.mock ? "mock" : "live"} treatment={t} />} />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-8 px-4 pt-8 pb-16 sm:px-8 sm:pt-10 print:p-0">
        <SavedBoard id={item.id} treatment={t} own={item.ownerId === viewer} shared={item.shared} />
      </main>
    </>
  );
}
