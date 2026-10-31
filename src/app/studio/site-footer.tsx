"use client";

import Link from "next/link";
import { useId } from "react";
import { TMDB_NOTICE } from "@/lib/agent/options";
import { accountsOn } from "@/lib/supabase/config";
import { Mark } from "./eggs";
import { useLingo } from "./lingo";
import { GitHubIcon } from "./icons";
import { NAV, REPO } from "./nav";

/** The header's sections, then the saved list that otherwise sits in the account menu (only when accounts are on). */
const PAGES = [...NAV, ...(accountsOn ? [{ id: "saved", href: "/saved", label: "Saved treatments" }] : [])];

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
 * The footer on every page, set like a film's end credits: what itsgiving is and where its source lives, its pages,
 * and who played which part, with the credits the data sources' terms ask for (TMDB's logo and notice, OpenStreetMap's
 * copyright line). It reads no URL, so every page stays as static as its own content allows.
 */
export function SiteFooter() {
  const { t } = useLingo();
  const pages = useId();
  return (
    <footer className="mx-auto w-full max-w-[80rem] px-4 pb-10 sm:px-8 print:hidden">
      <div className="grid gap-x-8 gap-y-8 border-t border-line pt-10 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-12">
        <div className="flex flex-col items-start gap-3 sm:col-span-2 lg:col-span-5">
          <p className="flex items-center gap-2.5">
            <Mark name="itsgiving" />
            <span className="sr-only">itsgiving</span>
          </p>
          <p className="max-w-[36ch] text-ui leading-6 text-dim">
            Treatments for music videos and short films, built from what their audience loves on Qloo.
          </p>
          <p className="text-ui font-bold">{t.footer}</p>
          <a
            href={REPO}
            className="press mt-1 inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-4 py-2 text-small font-semibold transition-colors hover:border-foreground"
          >
            <GitHubIcon size={16} />
            Source on GitHub
          </a>
        </div>

        <nav aria-labelledby={pages} className="lg:col-span-2">
          <h2 id={pages} className="text-small font-bold">
            Pages
          </h2>
          {/* Two short columns on a phone, one list from the small tablet up. */}
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-ui text-dim sm:flex sm:flex-col">
            {PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className={sweep}>
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-5">
          <h2 className="text-small font-bold">Credits</h2>
          {/* Roles on the right of a gutter and names on its left, as end credits are set. */}
          <dl className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
            <dt className="text-right text-small text-faint">Taste data</dt>
            <dd className="text-ui font-semibold">
              <a href="https://www.qloo.com/" className={inline}>
                Qloo
              </a>
            </dd>
            <dt className="text-right text-small text-faint">Film stills</dt>
            <dd>
              {/* TMDB's own logo file, unaltered (public/tmdb.svg, from themoviedb.org/about/logos-attribution), standing
                  in for its name beside the notice its terms ask for, below. */}
              <a href="https://www.themoviedb.org/" className="inline-flex min-h-6 items-center rounded-sm align-middle">
                {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, shown exactly as TMDB supplies it */}
                <img src="/tmdb.svg" alt="TMDB" width={92} height={12} className="h-3 w-auto" />
              </a>
            </dd>
            <dt className="text-right text-small text-faint">Maps</dt>
            <dd className="text-ui font-semibold">
              <a href="https://www.openstreetmap.org/copyright" className={inline}>
                © OpenStreetMap contributors
              </a>
            </dd>
            {/* DeepSeek writes first; Gemini and Groq stand in when it can't (src/lib/llm). */}
            <dt className="text-right text-small text-faint">Writing</dt>
            <dd className="text-ui font-semibold">DeepSeek, Gemini or Groq</dd>
          </dl>
          <p className="mt-4 max-w-[46ch] text-caption leading-5 text-faint">{TMDB_NOTICE}</p>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line pt-5 text-caption text-faint">
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
