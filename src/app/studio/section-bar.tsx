"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Treatment } from "@/lib/agent/types";
import { jumpOnClick } from "./jump";
import { useLingo } from "./lingo";
import { titleFont, titleStyle } from "./title-fonts";

// The sticky bar under a treatment's cover: the title, the way back, and a tab per section that lights the one in view.

/**
 * A treatment's sections, in reading order, for the section bar under the cover. A short film's music is only on boards
 * built since it was added (2026-10-28), and the story's people only since 2026-10-29: boards from 2026-10-28 have their
 * casting instead. A board without one has no tab for it.
 */
export function boardSections(t: Pick<Treatment, "characters" | "casting" | "music">): (readonly [string, string])[] {
  return [
    ["concept", "Concept"],
    ["references", "References"],
    ["beats", "Beats"],
    ...(t.characters ? [["characters", "Characters"] as const] : t.casting ? [["casting", "Casting"] as const] : []),
    ["wardrobe", "Wardrobe"],
    ["locations", "Locations"],
    // Short on the tab, whole as the section's heading: eleven tabs then fit from about 1280 px.
    ["camera", "Camera"],
    ["palette", "Palette"],
    ...(t.music ? [["music", "Music"] as const] : []),
    ["audience", "Audience"],
    ["credits", "Credits"],
  ];
}

/**
 * One sticky bar under the cover: the sections to jump to, the one being read lit, and a thin line that fills as the
 * reader goes down the board. Once the cover has scrolled away, the way back and the title join it on the left (inert
 * until then, so the keyboard never lands on them unseen). Its background runs to the window's edges.
 */
export function SectionBar({
  t,
  fontId,
  take,
  running,
  cover,
  article,
  back,
}: {
  t: Treatment;
  fontId: string;
  take: number;
  running: boolean;
  cover: RefObject<HTMLElement | null>;
  article: RefObject<HTMLElement | null>;
  back: ReactNode;
}) {
  const lingo = useLingo().t;
  const sections = boardSections(t);
  // The scrollspy reads the sections by id; it starts over only when the board's set of sections changes.
  const ids = sections.map(([id]) => id).join(" ");
  const [stuck, setStuck] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const line = useRef<HTMLSpanElement>(null);
  // On a narrow screen the tabs scroll sideways: the lit one is kept in view, and a fade marks the side with more.
  const tabs = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  const measure = () => {
    const nav = tabs.current;
    if (!nav) return;
    const before = nav.scrollLeft > 2;
    const after = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
    setMore((was) => (was.before === before && was.after === after ? was : { before, after }));
  };
  useEffect(() => {
    const nav = tabs.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    const offset = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: offset - (nav.clientWidth - link.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  }, [current]);

  // The lit tab's pill is one element under the tabs. After a click it slides to the tab the jump lights (translate,
  // and scaleX only while it moves); the scrollspy moves it at once, since nothing but this bar follows the scroll.
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef<{ x: number; w: number } | null>(null);
  const slide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sliding, setSliding] = useState(false);
  const place = useCallback((animate: boolean) => {
    const el = pill.current;
    const link = tabs.current?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!el) return;
    if (!link) {
      el.style.opacity = "0";
      placed.current = null;
      return;
    }
    const from = placed.current;
    const to = { x: link.offsetLeft, w: link.offsetWidth };
    const y = link.offsetTop;
    Object.assign(el.style, {
      opacity: "1",
      width: `${to.w}px`,
      height: `${link.offsetHeight}px`,
      transform: `translate(${to.x}px, ${y}px)`,
    });
    placed.current = to;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && from && !reduce && (from.x !== to.x || from.w !== to.w)) {
      el.animate(
        [{ transform: `translate(${from.x}px, ${y}px) scaleX(${from.w / to.w})` }, { transform: `translate(${to.x}px, ${y}px)` }],
        { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    }
  }, []);
  useLayoutEffect(() => place(slide.current !== undefined), [current, place]);
  useEffect(() => {
    const nav = tabs.current;
    if (!nav) return;
    // A font arriving late re-sizes the tabs, not the bar: watch the tabs themselves.
    const resized = new ResizeObserver(() => place(false));
    for (const link of nav.querySelectorAll("a")) resized.observe(link);
    return () => {
      resized.disconnect();
      clearTimeout(slide.current);
    };
  }, [place]);
  const slideNext = () => {
    clearTimeout(slide.current);
    setSliding(true);
    slide.current = setTimeout(() => {
      slide.current = undefined;
      setSliding(false);
    }, 400);
  };

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // The site header's height, when it's over the page (site-header.tsx sets --head).
      const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--head")) || 0;
      setStuck((cover.current?.getBoundingClientRect().bottom ?? 1) < head);
      let reading: string | null = null;
      for (const id of ids.split(" ")) {
        const heading = article.current?.querySelector(`#${id}`);
        if (heading && heading.getBoundingClientRect().top <= 120 + head) reading = id;
      }
      setCurrent(reading);
      const box = article.current?.getBoundingClientRect();
      if (box && line.current) {
        const progress = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height - window.innerHeight)));
        line.current.style.transform = `scaleX(${progress})`;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("resize", measure);
    };
  }, [cover, article, ids]);
  const edge = (fade: boolean) => (fade ? "transparent" : "#000");
  const mask =
    more.before || more.after
      ? `linear-gradient(to right, ${edge(more.before)}, #000 1.75rem, #000 calc(100% - 1.75rem), ${edge(more.after)})`
      : undefined;

  return (
    // Under the site header once that's on screen (its height is --head), else at the very top.
    <div className="sticky top-[var(--head,0px)] z-30 bg-background shadow-[0_0_0_100vmax_var(--background)] [clip-path:inset(0_-100vmax)] print:hidden">
      <div className="flex items-center gap-3 py-2">
        <div
          inert={!stuck}
          className={`flex min-w-0 shrink items-center gap-2.5 transition-opacity duration-200 ${stuck ? "opacity-100" : "opacity-0"}`}
        >
          {back}
          <span className="hidden min-w-0 truncate leading-tight sm:block" style={titleStyle(titleFont(fontId), "1.45rem")}>
            {t.title}
          </span>
          {take > 1 && (
            <span className="hidden shrink-0 rounded-md border border-edge px-2 py-0.5 font-mono text-label text-dim sm:inline">
              {lingo.take(take)}
            </span>
          )}
          {running && (
            <span className="flex shrink-0 items-center gap-2 text-caption font-semibold">
              <span aria-hidden className="size-2 rounded-full bg-foreground motion-safe:animate-pulse" />
              <span className="hidden sm:inline">{lingo.cookingAgain}</span>
            </span>
          )}
        </div>
        <nav
          ref={tabs}
          aria-label="Treatment sections"
          onScroll={measure}
          // A trackpad swipe past the last tab stays in the bar, rather than becoming the browser's Back (which in the
          // studio would leave the board).
          className="quiet-scroll relative isolate -mx-1 ml-auto flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain px-1"
          style={{ maskImage: mask, WebkitMaskImage: mask }}
        >
          <span
            ref={pill}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 -z-10 origin-left rounded-full bg-foreground opacity-0"
          />
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(event) => {
                slideNext();
                jumpOnClick(event, article.current?.querySelector<HTMLElement>(`#${id}`));
              }}
              aria-current={current === id ? "location" : undefined}
              // While the pill slides in, the lit label turns light as it arrives, never before.
              style={sliding && current === id ? { transitionDelay: "140ms" } : undefined}
              className="shrink-0 rounded-full px-2.5 py-1.5 text-small font-semibold whitespace-nowrap text-dim transition-colors duration-150 hover:text-foreground aria-[current=location]:text-background"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div aria-hidden className="h-0.5 bg-line">
        <span ref={line} className="block h-full origin-left bg-foreground" style={{ transform: "scaleX(0)" }} />
      </div>
    </div>
  );
}
