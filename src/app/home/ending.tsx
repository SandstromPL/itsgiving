"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { primaryButton, secondaryButton } from "../studio/ui";

/** Marks each `.rv` inside `root` as it comes on screen, once, so it rises into place. */
export function useArrivals<T extends HTMLElement>() {
  const root = useRef<T>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.on = "";
          observer.unobserve(entry.target);
        }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
    el.querySelectorAll<HTMLElement>(".rv").forEach((x) => {
      // Already above the screen (a page come back to): in place at once.
      if (x.getBoundingClientRect().bottom < 0) x.dataset.on = "";
      else observer.observe(x);
    });
    return () => observer.disconnect();
  });
  return root;
}

/** The way in, a screen of its own at the end of the homepage. */
export function Ending({ examples }: { examples: boolean }) {
  const root = useArrivals<HTMLElement>();
  return (
    <section ref={root} aria-labelledby="end-heading" className="home-end">
      <div className="rv mx-auto flex w-full max-w-[80rem] flex-col items-center gap-5.5 px-4 text-center sm:px-8">
        <h2 id="end-heading" className="type-head max-w-[14ch] text-display leading-[0.95] tracking-[-0.045em]">
          Make one for your next video or short.
        </h2>
        <p className="text-lead text-dim">An artist or a film, and a city, are enough to start.</p>
        <div className="mt-1.5 flex flex-wrap justify-center gap-3">
          <Link href="/studio" className={primaryButton}>
            Start a treatment
          </Link>
          {examples && (
            <Link href="/examples" className={secondaryButton}>
              See a finished one
            </Link>
          )}
        </div>
        <p className="text-small text-faint">No sign-up to build. A live build takes about a minute.</p>
      </div>
    </section>
  );
}
