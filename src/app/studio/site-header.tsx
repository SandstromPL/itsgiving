"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { scrollToY, useScrollFrame } from "../smooth";
import { AccountButton } from "./account";
import { Wordmark } from "./eggs";
import { onScreen } from "./jump";
import { UncSwitch } from "./lingo";
import { RoomSwitch } from "./theme";
import { GitHubIcon } from "./icons";
import { NAV, REPO, type Section } from "./nav";

export type { Section } from "./nav";

/**
 * Past the header to the page's own content, for the keyboard: focus moves into the <main> on screen (Next keeps pages
 * you've left in the document, hidden) without a #hash, which would add a history entry Back trips on (jump.ts).
 */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const main = [...document.querySelectorAll("main")].find((m) => m.getClientRects().length > 0);
  if (!main) return;
  event.preventDefault();
  main.tabIndex = -1;
  main.focus({ preventScroll: true });
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--head")) || 0;
  scrollToY(Math.max(0, main.getBoundingClientRect().top + window.scrollY - head));
}

/** When the header is on screen: always, or once the page has scrolled to an element (its top at the screen's top). */
export type Reveal = "always" | { after: string };

/**
 * The header on every page: the camera tile and the lettermark, the same three links with the current section lit,
 * the room the page is in (a button of its own), the plain-copy switch (its choice carries across pages, so it's on
 * every one), the source code on GitHub and the profile menu (the account, when accounts are set up). Pages add only
 * status badges, live or mock. Each page names its section rather than the header reading the URL: with Cache
 * Components a pathname read can suspend on a route's fallback shell, and a featured treatment's page must stay static.
 * It stays at the top. The homepage keeps it away through the title card and brings it in with the headline
 * (`reveal={{ after }}`, a mark the opening places at that point of its scroll, so a returning visitor, who opens on
 * the headline, has it at once): there it lies over the page instead of above it. Keyboard focus inside it always
 * shows it. Its height is `--head` on <html>, for what sticks below it. On phones it takes two rows: the marks, the
 * unc switch and the profile menu, then the links with the room and GitHub at their end.
 */
export function SiteHeader({
  home = false,
  current,
  badges,
  reveal = "always",
}: {
  /** On the homepage the wordmark is its tap egg; everywhere else it's the way home. */
  home?: boolean;
  current?: Section;
  badges?: ReactNode;
  reveal?: Reveal;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(reveal === "always");
  const after = typeof reveal === "object" ? reveal.after : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => document.documentElement.style.setProperty("--head", `${el.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  useScrollFrame(() => {
    if (!after) return;
    const target = onScreen(after);
    setShown(target ? target.getBoundingClientRect().top <= 1 : true);
  });

  return (
    <header
      ref={ref}
      data-hidden={shown ? undefined : ""}
      className={`site-header inset-x-0 top-0 z-40 border-b border-line bg-background print:hidden ${reveal === "always" ? "sticky" : "fixed"}`}
    >
      <a
        href="#main"
        onClick={skipToContent}
        className="sr-only rounded-full bg-foreground px-4 py-2.5 text-ui font-bold text-background focus:not-sr-only focus:absolute focus:top-2.5 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-16 w-full max-w-[80rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-8">
        <div className="order-1 lg:mr-2">
          <Wordmark href={home ? undefined : "/"} />
        </div>
        {/* Before the unc switch; on phones, where the first row is full, at the end of the links, before GitHub. With
            badges it shows the room's dots alone, as on a phone: in Tungsten its name and "Written by" broke the row. */}
        <RoomSwitch named={!badges} className={`order-6 ml-auto sm:order-4 ${badges ? "sm:ml-0" : ""}`} />
        <div className="order-2 ml-auto sm:order-4 sm:ml-0">
          <UncSwitch />
        </div>
        {/* Between the unc switch and the profile menu; on phones, after the room at the end of the links. */}
        <a
          href={REPO}
          aria-label="itsgiving's source code on GitHub"
          title="Source on GitHub"
          className="press order-6 grid size-10 place-items-center rounded-full border border-foreground bg-card text-foreground hover:bg-field sm:order-5 sm:size-12"
        >
          <GitHubIcon />
        </a>
        <AccountButton className="order-3 sm:order-6" />
        <span aria-hidden className="order-4 basis-full sm:hidden" />
        <nav aria-label="Site" className="order-5 -ml-2.5 flex items-center gap-1 sm:order-2 sm:ml-0">
          {NAV.map((item) => {
            const here = item.id === current;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={here ? "page" : undefined}
                className={`press rounded-full px-2.5 py-2 text-ui font-bold lg:px-3.5 ${
                  here ? "bg-foreground text-background" : "text-dim hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* Phones show only the mock warnings (ModeBadges), so without one the box goes: empty, it would still take a gap
            after the GitHub button and pull it in from the edge on the pages that have badges. */}
        {badges && (
          <div className="order-7 flex flex-wrap items-center gap-2 max-sm:[&:not(:has([data-tape]))]:hidden sm:order-3 sm:ml-auto">
            {badges}
          </div>
        )}
      </div>
    </header>
  );
}
