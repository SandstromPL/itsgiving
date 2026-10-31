"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { tmdbSize } from "@/lib/agent/options";
import { scrollToY, useScrollFrame } from "../smooth";
import { useLingo } from "../studio/lingo";
import { Still } from "../studio/parts";
import { titleFont, titleStyle } from "../studio/title-fonts";
import { CutLink } from "./cut-link";
import type { ShowFrame } from "./data";
import { clamp, reducedMotion } from "./motion";

/** Scroll runs the film a little faster than 1:1, so the frames don't take a screen each. */
const SPEED = 1.3;

// The feed and take-up reels either side of the gate: drawn film reels, the same in every room (the strip is a frame).
const REEL_HOLES =
  "M97 0A97 97 0 1 0-97 0A97 97 0 1 0 97 0ZM27-50A27 27 0 1 0-27-50A27 27 0 1 0 27-50ZM70.3 25A27 27 0 1 0 16.3 25A27 27 0 1 0 70.3 25ZM-16.3 25A27 27 0 1 0-70.3 25A27 27 0 1 0-16.3 25Z";
function Reel({ full, className }: { full: boolean; className: string }) {
  return (
    <svg className={className} viewBox="-100 -100 200 200" aria-hidden>
      <circle r="96" fill="#0d0b09" />
      <circle r={full ? 90 : 34} fill="#24190f" />
      {(full ? [74, 58, 42] : [26]).map((r) => (
        <circle key={r} r={r} fill="none" stroke="#2f2217" strokeWidth="1.5" />
      ))}
      <path fillRule="evenodd" fill="#2c2823" stroke="#4d463c" strokeWidth="2" d={REEL_HOLES} />
      <circle r="15" fill="#3c362e" />
      <circle r="5.5" fill="#0a0908" />
      <rect x="-1.6" y="-15" width="3.2" height="8" fill="#0a0908" />
    </svg>
  );
}

const Leader = () => (
  <div className="fframe fframe--leader" aria-hidden>
    <div className="fpic" />
  </div>
);

/**
 * "Now showing": the featured treatments on a flatbed, run sideways past the gate as you scroll, pinned until the last
 * frame (the one still to be made, yours) has gone by. The caption under the gate names the frame in it. Opening a
 * frame plays the camera cut into its board. Under reduced motion the strip is a row that scrolls sideways by itself.
 */
export function Flatbed({ frames }: { frames: ShowFrame[] }) {
  const { t } = useLingo();
  const [shown, setShown] = useState(0);
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const feed = useRef<SVGSVGElement>(null);
  const take = useRef<SVGSVGElement>(null);
  const s = useRef({
    pinned: false,
    top: 0,
    pitch: 1,
    gateX: 0,
    x0: 0,
    travel: 0,
    rFeed: 1,
    rTake: 1,
    centers: [] as number[],
    starts: [] as number[],
    vw: 0,
    vh: 0,
    shown: 0,
  }).current;

  const show = (i: number) => {
    if (i === s.shown) return;
    s.shown = i;
    setShown(i);
  };

  const measure = () => {
    const sec = section.current;
    const st = strip.current;
    const w = win.current;
    if (!sec || !st || !w || !stage.current) return;
    s.vw = innerWidth;
    s.vh = innerHeight;
    s.pinned = !reducedMotion();
    if (s.pinned) delete sec.dataset.static;
    else sec.dataset.static = "";
    st.style.transform = "";
    const all = Array.from(st.querySelectorAll<HTMLElement>(".fframe"));
    const content = all.filter((f) => f.dataset.i !== undefined);
    s.centers = all.map((f) => f.offsetLeft + f.offsetWidth / 2);
    s.starts = content.map((f) => f.offsetLeft + f.offsetWidth / 2);
    s.pitch = content.length > 1 ? s.starts[1] - s.starts[0] : content[0]?.offsetWidth || 1;
    s.gateX = w.clientWidth / 2;
    s.x0 = s.gateX - (s.starts[0] ?? 0);
    s.travel = (content.length - 1) * s.pitch;
    s.rFeed = ((feed.current?.getBoundingClientRect().width ?? 2) / 2) * 0.93;
    s.rTake = ((take.current?.getBoundingClientRect().width ?? 2) / 2) * 0.93;
    // Tall enough to run the whole strip past the gate, plus a beat at the end before the page goes on.
    sec.style.height = s.pinned ? `${Math.round(stage.current.offsetHeight + s.travel / SPEED + innerHeight * 0.25)}px` : "";
    s.top = sec.getBoundingClientRect().top + scrollY;
    if (!s.pinned) {
      all.forEach((f) => f.style.removeProperty("--shade"));
      if (feed.current) feed.current.style.transform = "";
      if (take.current) take.current.style.transform = "";
    }
  };

  useScrollFrame((y) => {
    if (innerWidth !== s.vw || Math.abs(innerHeight - s.vh) > 150) measure();
    const st = strip.current;
    if (!s.pinned || !st) return;
    const moved = clamp((y - s.top) / (s.travel / SPEED || 1)) * s.travel;
    const x = s.x0 - moved;
    st.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    if (feed.current) feed.current.style.transform = `rotate(${((moved / s.rFeed) * 57.2958).toFixed(2)}deg)`;
    if (take.current) take.current.style.transform = `rotate(${((moved / s.rTake) * 57.2958).toFixed(2)}deg)`;
    st.querySelectorAll<HTMLElement>(".fframe").forEach((f, i) => {
      const d = Math.abs((s.centers[i] ?? 0) + x - s.gateX) / s.pitch;
      f.style.setProperty("--shade", (Math.min(1, d) * 0.6).toFixed(3));
    });
    show(Math.round(moved / s.pitch));
  });

  // Tabbing to a frame brings it to the gate: the page scrolls to where that frame stands in it.
  const focusFrame = (i: number) => {
    if (!s.pinned) return;
    // After the browser's own scroll to the focused frame, which would otherwise win.
    requestAnimationFrame(() => {
      const target = s.top + (i * s.pitch) / SPEED;
      if (Math.abs(scrollY - target) > 2) scrollToY(target);
    });
  };
  // In the row that scrolls by itself, the caption follows the frame nearest the middle.
  const onRowScroll = () => {
    const w = win.current;
    if (s.pinned || !w) return;
    const middle = w.scrollLeft + w.clientWidth / 2;
    let best = 0;
    s.starts.forEach((c, i) => {
      if (Math.abs(c - middle) < Math.abs(s.starts[best] - middle)) best = i;
    });
    show(best);
  };

  const now = frames[shown];
  const font = now && titleFont(now.fontId);
  return (
    <section ref={section} className="ns surface-dark bg-frame text-foreground" aria-labelledby="ns-heading">
      <div ref={stage} className="ns-stage">
        <div className="mx-auto flex w-full max-w-[80rem] items-baseline justify-between gap-4 px-4 sm:px-8">
          <h2 id="ns-heading" className="type-head text-section leading-none">
            {t.nowShowing}
          </h2>
          <Link href="/examples" className="text-ui font-bold whitespace-nowrap text-dim underline underline-offset-4">
            All examples
          </Link>
        </div>
        <div className="bed">
          <div ref={win} className="strip-window quiet-scroll" onScroll={onRowScroll}>
            <div ref={strip} className="strip">
              <Leader />
              <Leader />
              {frames.map((frame, i) => (
                <CutLink
                  key={frame.slug}
                  href={`/t/${frame.slug}`}
                  data-i={i}
                  className="fframe"
                  aria-label={`${frame.title}: open the treatment`}
                  onFocus={() => focusFrame(i)}
                >
                  <span className="fpic">
                    {frame.still && <Still src={tmdbSize(frame.still, "w780")} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="fname text-subhead">{frame.title}</span>
                </CutLink>
              ))}
              <Link
                href="/studio"
                data-i={frames.length}
                className="fframe fframe--yours"
                aria-label={`${t.nextUp.title}: start a treatment`}
                onFocus={() => focusFrame(frames.length)}
              >
                <span className="fpic">
                  <span className="text-caption text-dim">{t.nextUp.label}</span>
                  <span className="type-poster text-display-sm">{t.nextUp.title}</span>
                </span>
              </Link>
              <Leader />
              <Leader />
            </div>
          </div>
          <Reel full={false} className="reel reel--take" />
          <Reel full className="reel reel--feed" />
          <i className="gate-light" aria-hidden />
        </div>
        <div className="ns-cap mx-auto w-full max-w-[80rem] px-4 sm:px-8" aria-live="polite">
          {now && font ? (
            <>
              <p className="text-small text-dim tabular-nums">
                {now.meta}. {shown + 1} of {frames.length}
              </p>
              <p className="leading-none text-balance" style={titleStyle(font, "var(--text-subsection)")}>
                {now.title}
              </p>
              <p className="cap-log max-w-[56ch] font-serif text-lead leading-[1.32] text-pretty">{now.logline}</p>
              <CutLink
                href={`/t/${now.slug}`}
                className="press inline-flex min-h-10 items-center rounded-full bg-foreground px-4 text-small font-bold text-background"
              >
                Open the treatment
              </CutLink>
            </>
          ) : (
            <>
              <p className="text-small text-dim">{t.nextUp.label}</p>
              <p className="type-poster text-subsection leading-none">{t.nextUp.title}</p>
              <p className="cap-log max-w-[56ch] font-serif text-lead leading-[1.32]">
                Give it an artist, or the films your short is after, and a city.
              </p>
              <Link
                href="/studio"
                className="press inline-flex min-h-10 items-center rounded-full bg-foreground px-4 text-small font-bold text-background"
              >
                Start a treatment
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Without featured treatments (a server with no keys, or a deploy that hasn't built them), the page says why. */
export function FlatbedEmpty({ live }: { live: boolean }) {
  const { t } = useLingo();
  return (
    <section aria-labelledby="ns-heading" className="mx-auto w-full max-w-[80rem] px-4 py-16 sm:px-8">
      <div className="flex flex-col items-start gap-4 rounded-[28px] border border-line bg-card p-8">
        <h2 id="ns-heading" className="type-head text-section leading-none">
          {t.nowShowing}
        </h2>
        <p className="max-w-[60ch] text-lead leading-[1.55] text-dim">
          {live
            ? "Featured treatments are built from live Qloo data when the site is deployed, and this deploy hasn't built them yet. The studio still builds treatments."
            : "Featured treatments are built from live Qloo data when the site is deployed with its keys, and this server has none. The studio still builds treatments."}
        </p>
        <Link
          href="/studio"
          className="press inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-ui font-bold text-background"
        >
          Start a treatment
        </Link>
      </div>
    </section>
  );
}
