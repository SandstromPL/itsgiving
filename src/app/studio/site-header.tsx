"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./eggs";
import { UncSwitch } from "./lingo";
import { ThemeSwitch } from "./theme";

/** A plain link in the header: Studio, Examples. */
export function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-full px-3 py-2 text-[15px] font-semibold text-dim hover:bg-card hover:text-foreground">
      {children}
    </Link>
  );
}

/**
 * The header on every page. It scrolls away with the page; a board has its own sticky section bar. Each page brings
 * its own links and badges: the homepage's badges would make it render per request, and a featured page's must not.
 * On phones the wordmark and the unc switch share the first row and the badges and the theme the second; the links
 * stay off, since every page carries its own ways on (the hero's buttons, the way back above a board, the closing
 * call) and three rows would push the page down.
 */
export function SiteHeader({
  home = false,
  links,
  badges,
  unc = false,
}: {
  /** On the homepage the wordmark is its tap egg; everywhere else it's the way home. */
  home?: boolean;
  links?: ReactNode;
  badges?: ReactNode;
  /** The plain-copy switch, for the pages where the tool talks. */
  unc?: boolean;
}) {
  return (
    <header className="border-b border-line/80 print:border-0">
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[80rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-8">
        <div className="order-1 sm:mr-2">
          <Wordmark href={home ? undefined : "/"} />
        </div>
        {links && (
          <nav aria-label="Site" className="order-4 hidden items-center gap-1 sm:order-2 sm:flex">
            {links}
          </nav>
        )}
        {badges && <div className="order-5 flex flex-wrap items-center gap-2 sm:order-3 sm:ml-auto print:hidden">{badges}</div>}
        {unc && (
          <div className="order-2 ml-auto sm:order-4 sm:ml-0">
            <UncSwitch />
          </div>
        )}
        {unc && <span aria-hidden className="order-3 basis-full sm:hidden" />}
        <div className={`order-6 ml-auto sm:order-5 ${badges || unc ? "sm:ml-0" : ""}`}>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
