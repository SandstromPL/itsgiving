"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./eggs";
import { jumpOnClick, onScreen } from "./jump";
import { UncSwitch } from "./lingo";
import { ThemeSwitch } from "./theme";

/** The site's sections, the same in every header. The examples live on the homepage; a featured treatment is one. */
const NAV = [
  { id: "examples", href: "/#now-showing", label: "Examples" },
  { id: "studio", href: "/studio", label: "Studio" },
  { id: "about", href: "/about", label: "About" },
] as const;

export type Section = (typeof NAV)[number]["id"];

/**
 * The header on every page: the wordmark, the same three links with the current section lit, the plain-copy switch
 * (its choice carries across pages, so it's on every one) and the theme. Pages add only status badges, live or mock.
 * Each page names its section rather than the header reading the URL: with Cache Components a pathname read can
 * suspend on a route's fallback shell, and a featured treatment's page must stay static. It scrolls away with the
 * page; a board has its own sticky section bar. On phones it takes two rows: the wordmark and the unc switch, then
 * the links and the theme. Badges wrap below only when they warn (mock data); "Live Qloo data" stays off phones.
 */
export function SiteHeader({
  home = false,
  current,
  badges,
}: {
  /** On the homepage the wordmark is its tap egg; everywhere else it's the way home. */
  home?: boolean;
  current?: Section;
  badges?: ReactNode;
}) {
  return (
    <header className="border-b border-line/80 print:border-0">
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-[80rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-8">
        <div className="order-1 sm:mr-2">
          <Wordmark href={home ? undefined : "/"} />
        </div>
        <div className={`order-2 ml-auto sm:order-4 ${badges ? "sm:ml-0" : ""} print:hidden`}>
          <UncSwitch />
        </div>
        <span aria-hidden className="order-3 basis-full sm:hidden" />
        <nav aria-label="Site" className="order-4 -ml-2.5 flex items-center gap-1 sm:order-2 sm:ml-0 print:hidden">
          {NAV.map((item) => {
            const here = item.id === current;
            return (
              <Link
                key={item.id}
                href={item.href}
                // On the homepage the strip is on this page: Next does nothing for a link to the address it's already
                // on, so the link jumps there itself, every time.
                onClick={home && item.id === "examples" ? (event) => jumpOnClick(event, onScreen("now-showing")) : undefined}
                // The examples link points at the homepage's strip, so on a featured treatment it's the current
                // section rather than the current page.
                aria-current={here ? (item.id === "examples" ? "true" : "page") : undefined}
                className={`rounded-full px-2.5 py-2 text-[15px] font-semibold sm:px-3 ${
                  here ? "bg-foreground text-background" : "text-dim hover:bg-card hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="order-5 ml-auto sm:ml-0 print:hidden">
          <ThemeSwitch />
        </div>
        {badges && <div className="order-6 flex flex-wrap items-center gap-2 sm:order-3 sm:ml-auto print:hidden">{badges}</div>}
      </div>
    </header>
  );
}
