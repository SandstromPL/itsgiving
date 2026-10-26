"use client";

import Link from "next/link";
import { useLingo } from "./lingo";

/** The footer on every page, with the credits the data sources ask for. */
export function SiteFooter() {
  const { t } = useLingo();
  return (
    <footer className="mx-auto w-full max-w-[80rem] px-4 pb-10 sm:px-8 print:hidden">
      <div className="flex flex-col gap-2 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-[15px] text-dim">
          <span className="font-bold text-foreground">{t.footer}</span>
          <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {process.env.NODE_ENV !== "production" && (
              <Link href="/playground" className="text-[14px] text-faint underline decoration-line underline-offset-4 hover:text-dim">
                Tool playground (development)
              </Link>
            )}
            <Link
              href="/about"
              className="font-semibold text-foreground underline decoration-line underline-offset-4 hover:decoration-foreground"
            >
              About itsgiving
            </Link>
            <span>Built on Qloo&apos;s taste graph. itsgiving, 2026.</span>
          </span>
        </div>
        <p className="text-[13px] leading-5 text-faint">
          Maps © OpenStreetMap contributors. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </footer>
  );
}
