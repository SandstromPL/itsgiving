import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "./studio/site-header";

export const metadata: Metadata = { title: "Page not found: itsgiving" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col justify-center gap-6 px-4 py-24 sm:px-8">
        <span className="-rotate-3 self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">404</span>
        <h1 className="type-poster max-w-[14ch] text-[clamp(3.5rem,8vw,7rem)]">this page is giving… nothing</h1>
        <p className="max-w-[44ch] text-[1.2rem] leading-[1.45] text-dim">
          Page not found. The link may be old, or the treatment was never saved.
        </p>
        <Link href="/" className="self-start rounded-full bg-foreground px-6 py-3.5 text-[16px] font-bold text-background">
          Back to the homepage
        </Link>
      </main>
    </>
  );
}
