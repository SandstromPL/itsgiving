import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInButton } from "@/app/studio/account";
import { primaryButton } from "@/app/studio/landing";
import { SiteHeader } from "@/app/studio/site-header";
import { tmdbSize } from "@/lib/agent/options";
import { SavedStoreError, savedList, type SavedSummary } from "@/lib/saved/store";
import { accountsOn } from "@/lib/supabase/config";
import { viewerId } from "@/lib/supabase/server";
import { DeleteAccount } from "./delete-account";

// The signed-in person's saved treatments, newest first, each opening its own page (/s/<id>), and at the foot a way to
// delete the account. Signed out, it asks them to sign in; it's also where a cancelled or failed sign-in lands
// (?signin=failed) and where a deleted account lands (?account=deleted), and says which.

export const metadata: Metadata = { title: "Your treatments: itsgiving", robots: { index: false, follow: false } };

const shell = "mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-8 px-4 pt-8 pb-16 sm:px-8 sm:pt-10";

export default function SavedListPage({ searchParams }: PageProps<"/saved">) {
  return (
    <>
      <SiteHeader />
      <main className={shell}>
        <h1 className="type-poster text-[clamp(3rem,6vw,4.75rem)]">your treatments</h1>
        <Suspense
          fallback={
            <p role="status" className="text-[15px] text-dim">
              Opening your treatments…
            </p>
          }
        >
          <SavedList searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function SavedList({ searchParams }: { searchParams: PageProps<"/saved">["searchParams"] }) {
  const { signin, account } = await searchParams;
  if (!accountsOn) return <p className="max-w-[46ch] text-[1.15rem] leading-[1.5] text-dim">Accounts aren&apos;t set up on this server.</p>;
  const viewer = await viewerId();
  if (!viewer) {
    return (
      <div className="flex max-w-[42rem] flex-col items-start gap-5 rounded-[28px] border border-line bg-card p-8">
        {account === "deleted" && (
          <p role="status" className="text-[1.05rem] font-semibold text-foreground">
            Your account is deleted, with every treatment it saved.
          </p>
        )}
        {signin === "failed" && (
          <p role="alert" className="text-[1.05rem] font-semibold text-safelight">
            Sign-in didn&apos;t finish. Try again, or pick the other account.
          </p>
        )}
        <p className="text-[1.15rem] leading-[1.5] text-dim">
          {account === "deleted"
            ? "Signing in again with Google or GitHub starts a new, empty account. Building a treatment needs none."
            : "Sign in with Google or GitHub to see the treatments you've saved. Building one needs no account."}
        </p>
        <SignInButton next="/saved" className={primaryButton} />
      </div>
    );
  }
  let items: SavedSummary[];
  try {
    items = await savedList(viewer);
  } catch (err) {
    if (!(err instanceof SavedStoreError)) throw err;
    console.error(JSON.stringify({ evt: "saved", action: "list", outcome: "unavailable", error: err.message }));
    return (
      <p role="alert" className="max-w-[46ch] text-[1.15rem] leading-[1.5] text-dim">
        Your saved treatments didn&apos;t load: the database didn&apos;t answer. Try again in a minute.
      </p>
    );
  }
  return (
    <>
      {items.length === 0 ? (
        <div className="flex max-w-[42rem] flex-col items-start gap-5">
          <p className="text-[1.15rem] leading-[1.5] text-dim">Nothing saved yet. Build a treatment, then press Save on its board.</p>
          <Link href="/studio" className={primaryButton}>
            Open the studio
          </Link>
        </div>
      ) : (
        <SavedGrid items={items} />
      )}
      <DeleteAccount saved={items.length} />
    </>
  );
}

function SavedGrid({ items }: { items: SavedSummary[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/s/${item.id}`}
            className="flex h-full flex-col overflow-hidden rounded-[26px] border border-line bg-card hover:border-foreground"
          >
            <span className="surface-dark relative block aspect-video bg-background">
              {item.cover && (
                // eslint-disable-next-line @next/next/no-img-element -- TMDB stills; the board shows them the same way
                <img src={tmdbSize(item.cover, "w780")} alt="" loading="lazy" className="size-full object-cover opacity-80" />
              )}
              {item.shared && (
                <span className="absolute top-3 left-3 rounded-full bg-accent px-2.5 py-1 text-[13px] font-bold text-[#121211]">
                  Shared
                </span>
              )}
            </span>
            <span className="flex flex-1 flex-col gap-1.5 p-5">
              <span className="type-head text-[1.45rem] leading-tight">{item.title}</span>
              <span className="text-[14px] leading-5 text-dim">{item.summary}</span>
              <span className="mt-auto pt-2 text-[13px] text-faint">
                Saved {new Date(item.savedAt).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" })}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
