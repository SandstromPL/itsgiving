"use client";

import Link from "next/link";
import { useId, type MouseEvent } from "react";
import { Mark } from "./eggs";
import { jumpOnClick, onScreen } from "./jump";
import { useLingo } from "./lingo";

/** The site's pages, in the header's order, then the saved list that otherwise sits in the account menu. */
const PAGES = [
  { href: "/#now-showing", label: "Examples" },
  { href: "/studio", label: "Studio" },
  { href: "/about", label: "About" },
  { href: "/saved", label: "Saved treatments" },
] as const;

/**
 * A link in a list: no underline at rest, since the list says what it is; on hover or focus one sweeps in from the
 * left and leaves a little faster. A transform on the site's ease-out, so reduced motion drops the sweep and keeps
 * the colour change (globals.css).
 */
const sweep =
  "relative inline-flex min-h-6 items-center transition-colors hover:text-foreground focus-visible:text-foreground " +
  "after:absolute after:inset-x-0 after:bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-current " +
  "after:transition-transform after:duration-150 after:ease-out hover:after:scale-x-100 hover:after:duration-200 focus-visible:after:scale-x-100";

/** A link inside a line of text keeps the site's resting underline, so it stands apart from the words around it. */
const inline = "underline decoration-line underline-offset-4 transition-colors hover:decoration-foreground";

/**
 * The footer on every page, set like a film's end credits: what itsgiving is, its pages, and who played which part,
 * with the credits the data sources' terms ask for (TMDB's logo and notice, OpenStreetMap's copyright line). It reads
 * no URL, so every page stays as static as its own content allows; the Examples link looks at the page only when
 * clicked.
 */
export function SiteFooter() {
  const { t } = useLingo();
  const pages = useId();
  // On the homepage the strip is on this page, and Next does nothing for a link to the address it's already on.
  const toExamples = (event: MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === "/") jumpOnClick(event, onScreen("now-showing"));
  };
  return (
    <footer className="mx-auto w-full max-w-[80rem] px-4 pb-10 sm:px-8 print:hidden">
      <div className="grid gap-x-8 gap-y-8 border-t border-line pt-10 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-12">
        <div className="flex flex-col items-start gap-3 sm:col-span-2 lg:col-span-5">
          <p className="flex items-center gap-2.5">
            <Mark name="itsgiving" />
            <span className="sr-only">itsgiving</span>
          </p>
          <p className="max-w-[36ch] text-[15px] leading-6 text-dim">
            Treatments for music videos and short films, built from what their audience loves on Qloo.
          </p>
          <p className="text-[15px] font-bold">{t.footer}</p>
        </div>

        <nav aria-labelledby={pages} className="lg:col-span-2">
          <h2 id={pages} className="text-[14px] font-bold">
            Pages
          </h2>
          {/* Two short columns on a phone, one list from the small tablet up. */}
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[15px] text-dim sm:flex sm:flex-col">
            {PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} onClick={page.href === "/#now-showing" ? toExamples : undefined} className={sweep}>
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-5">
          <h2 className="text-[14px] font-bold">Credits</h2>
          {/* Roles on the right of a gutter and names on its left, as end credits are set. */}
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
            <dt className="text-right text-[14px] text-faint">Taste data</dt>
            <dd className="text-[15px] font-semibold">
              <a href="https://www.qloo.com/" className={inline}>
                Qloo
              </a>
            </dd>
            <dt className="text-right text-[14px] text-faint">Film stills</dt>
            <dd>
              {/* TMDB's own logo file, unaltered (public/tmdb.svg, from themoviedb.org/about/logos-attribution), standing
                  in for its name beside the notice its terms ask for, below. */}
              <a href="https://www.themoviedb.org/" className="inline-flex min-h-6 items-center rounded-sm align-middle">
                {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, shown exactly as TMDB supplies it */}
                <img src="/tmdb.svg" alt="TMDB" width={92} height={12} className="h-3 w-auto" />
              </a>
            </dd>
            <dt className="text-right text-[14px] text-faint">Maps</dt>
            <dd className="text-[15px] font-semibold">
              <a href="https://www.openstreetmap.org/copyright" className={inline}>
                © OpenStreetMap contributors
              </a>
            </dd>
            {/* DeepSeek writes first; Gemini and Groq stand in when it can't (src/lib/llm). */}
            <dt className="text-right text-[14px] text-faint">Writing</dt>
            <dd className="text-[15px] font-semibold">DeepSeek, Gemini or Groq</dd>
          </dl>
          <p className="mt-4 max-w-[46ch] text-[13px] leading-5 text-faint">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line pt-5 text-[13px] text-faint">
        <p>© 2026 itsgiving</p>
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {process.env.NODE_ENV !== "production" && (
            <Link href="/playground" className={sweep}>
              Tool playground (development)
            </Link>
          )}
          <a href="https://qloo.devpost.com/" className={sweep}>
            Made for the Qloo Agentic Hackathon
          </a>
        </p>
      </div>
    </footer>
  );
}
