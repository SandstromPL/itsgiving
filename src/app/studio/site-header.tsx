"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useScrollFrame } from "../smooth";
import { AccountButton } from "./account";
import { Wordmark } from "./eggs";
import { onScreen } from "./jump";
import { UncSwitch } from "./lingo";
import { GitHubIcon } from "./icons";
import { NAV, REPO, type Section } from "./nav";

export type { Section } from "./nav";

/** When the header is on screen: always, once the page has scrolled, or once an element's top is above 62% of it. */
export type Reveal = "always" | "scroll" | { after: string };

/**
 * The header on every page: the camera tile and the lettermark, the same three links with the current section lit,
 * the plain-copy switch (its choice carries across pages, so it's on every one), the source code on GitHub and the
 * profile menu (the rooms, and the account when accounts are set up). Pages add only status badges, live or mock.
 * Each page names its section rather than the header reading the URL: with Cache Components a pathname read can
 * suspend on a route's fallback shell, and a featured treatment's page must stay static.
 * It stays at the top. The homepage keeps it away until "Watch it work" (`reveal={{ after }}`) and a board until you
 * scroll (`"scroll"`): those pages start under no header, so there it lies over the page instead of above it. Keyboard
 * focus inside it always shows it. Its height is `--head` on <html>, for what sticks below it. On phones it takes two
 * rows: the marks, the unc switch and the profile menu, then the links.
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

  useScrollFrame((y) => {
    if (reveal === "always") return;
    if (reveal === "scroll") return setShown(y > 40);
    const target = after ? onScreen(after) : null;
    setShown(target ? target.getBoundingClientRect().top < innerHeight * 0.62 : true);
  });

  return (
    <header
      ref={ref}
      data-hidden={shown ? undefined : ""}
      className={`site-header inset-x-0 top-0 z-40 border-b border-line bg-background print:hidden ${reveal === "always" ? "sticky" : "fixed"}`}
    >
      <div className="mx-auto flex min-h-16 w-full max-w-[80rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-8">
        <div className="order-1 lg:mr-2">
          <Wordmark href={home ? undefined : "/"} />
        </div>
        <div className={`order-2 ml-auto sm:order-4 ${badges ? "sm:ml-0" : ""}`}>
          <UncSwitch />
        </div>
        {/* Between the unc switch and the profile menu; on phones, where that row is full, at the end of the links. */}
        <a
          href={REPO}
          aria-label="itsgiving's source code on GitHub"
          title="Source on GitHub"
          className="press order-6 ml-auto grid size-10 place-items-center rounded-full border border-foreground bg-card text-foreground hover:bg-field sm:order-5 sm:ml-0 sm:size-12"
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
        {badges && <div className="order-7 flex flex-wrap items-center gap-2 sm:order-3 sm:ml-auto">{badges}</div>}
      </div>
    </header>
  );
}
