import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { ModeBadges } from "@/app/studio/parts";
import { SiteHeader } from "@/app/studio/site-header";
import { SavedStoreError, savedForViewer } from "@/lib/saved/store";
import { viewerId } from "@/lib/supabase/server";
import { SavedBoard, SavedMissing } from "./saved-board";

// A saved treatment's page: its owner's always, anyone's while it's shared. Read at request time (it depends on who's
// asking), behind Suspense, so the shell streams first. The proxy has answered before it starts (src/proxy.ts): a 404
// for a treatment this visitor can't open, and the limit on opens. So the words here for a missing treatment or a
// database that won't answer are for the moment in between: deleted, or failing, after the proxy's check. No page here
// is ever indexed: a share link is for whoever it's given to.

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
  const { item, viewer } = await lookup(id);
  if (!item || item === "unavailable") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col justify-center gap-6 px-4 py-24 sm:px-8">
          {item === "unavailable" ? (
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
