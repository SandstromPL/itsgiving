"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { LETTERMARK_BOX, Lettermark, lettermarkPortal } from "../marks";
import { useScrollFrame } from "../smooth";
import { clamp, outCubic, rackFocus, reducedMotion, tween } from "./motion";
import "./home.css";

// The homepage's first screen: the title card, the 2B lettermark on black, loaded in 1B rack focus, its reels rolling.
// Scrolling parks a window of the second g at the top and dollies through it until the window is the screen; after a
// beat of black, "your voice, their taste." racks into focus word by word and holds the screen. It's all part of the
// scroll, both ways: scrolling back up darkens the words and pulls back out of the window to the card, and coming
// through again racks the words in again. Under reduced motion the card fades out instead and the words fade in.

const [BX, BY, BW, BH] = LETTERMARK_BOX;
/** Where the mark sits: as wide as 72% of the screen or 155% of its height, whichever is less, its baseline 46% down. */
const WIDE = 0.72;
const TALL = 1.55;
const BASELINE = 0.46;
/** The g's take-up window, at rest: the opening the dolly goes through. */
const P0 = lettermarkPortal(0, 1);
/** The five windows come round every 72 degrees. */
const WINDOW = 72;

/** The mark's box on a W x H card, in px: the same numbers the CSS below gives it before any script runs. */
function placeMark(W: number, H: number) {
  const ww = Math.min(W * WIDE, H * TALL);
  const k = ww / BW;
  return { k, left: (W - ww) / 2, top: H * BASELINE + (264 + BY) * k };
}

const markStyle = {
  "--ww": `min(${WIDE * 100}cqw, ${TALL * 100}cqh)`,
  width: "var(--ww)",
  height: `calc(var(--ww) * ${BH / BW})`,
  left: "calc((100cqw - var(--ww)) / 2)",
  top: `calc(${BASELINE * 100}cqh + var(--ww) * ${(264 + BY) / BW})`,
} as CSSProperties;

/** The hole through the black is a little wider than the window, so its edge always sits under the g's body. */
const HOLE = P0.r * 1.15;
const holeStyle = {
  "--ww": `min(${WIDE * 100}cqw, ${TALL * 100}cqh)`,
  width: `calc(var(--ww) * ${(2 * HOLE) / BW})`,
  height: `calc(var(--ww) * ${(2 * HOLE) / BW})`,
  left: `calc((100cqw - var(--ww)) / 2 + var(--ww) * ${(P0.cx - BX - HOLE) / BW})`,
  top: `calc(${BASELINE * 100}cqh + var(--ww) * ${(264 + P0.cy - HOLE) / BW})`,
} as CSSProperties;

export function Opening() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const film = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const ui = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const s = useRef({
    /** The title card has loaded (its rack focus played): once per page, even when Next shows it again after Back. */
    started: false,
    reduce: false,
    W: 0,
    H: 0,
    vw: 0,
    vh: 0,
    top: 0,
    dist: 0,
    hold: 0,
    p: 0,
    angle: 0,
    speed: 0,
    rolling: false,
    ready: false,
    parking: false,
    revealed: false,
    raf: 0,
    last: 0,
  }).current;

  // Fill the width with the two lines, as the words alone (the size is fitted, like a title card's).
  const fit = () => {
    const h = heading.current;
    const box = h?.parentElement;
    if (!h || !box) return;
    h.style.fontSize = "100px";
    const widest = Math.max(
      ...Array.from(h.querySelectorAll(".hero-line"), (line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return range.getBoundingClientRect().width;
      }),
    );
    const cs = getComputedStyle(box);
    const room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (widest > 0) h.style.fontSize = `${Math.floor(Math.min((room / widest) * 100 * 0.99, 300))}px`;
  };

  const turnReels = () => {
    mark.current?.querySelectorAll<SVGGElement>("[data-reel]").forEach((g) => {
      g.setAttribute("transform", `rotate(${s.angle.toFixed(2)} ${g.dataset.c ?? ""})`);
    });
  };

  const reveal = (delay: number) => {
    if (s.revealed) return;
    s.revealed = true;
    const words = Array.from(heading.current?.querySelectorAll(".hero-w") ?? []);
    rackFocus(words, { delay, stagger: 150, duration: 1150, scale: 1.06, blur: 18 });
    delete section.current?.dataset.dark;
  };
  /** Back up into the window: the words go dark again, so coming through brings them into focus again. */
  const conceal = () => {
    if (!s.revealed) return;
    s.revealed = false;
    heading.current?.querySelectorAll<HTMLElement>(".hero-w").forEach((word) => word.getAnimations().forEach((a) => a.cancel()));
    if (section.current) section.current.dataset.dark = "";
  };

  const draw = () => {
    const f = film.current;
    if (!s.W || !f) return;
    const m = placeMark(s.W, s.H);
    const P = lettermarkPortal(s.angle, 1);
    const x = m.left + (P.cx - BX) * m.k;
    const y = m.top + (P.cy - BY) * m.k;
    const r = P.r * m.k;
    const far = Math.max(Math.hypot(x, y), Math.hypot(s.W - x, y), Math.hypot(x, s.H - y), Math.hypot(s.W - x, s.H - y));
    // The dolly: zoom is linear in scroll on a log scale, so it reads as a steady push in.
    const zp = clamp((s.p - 0.05) / 0.9);
    const z = Math.exp(Math.log((far / r) * 1.04) * zp);
    if (hole.current) {
      hole.current.style.transform = `translate(${((P.cx - P0.cx) * m.k).toFixed(2)}px, ${((P.cy - P0.cy) * m.k).toFixed(2)}px)`;
      hole.current.dataset.open = zp > 0 && !s.reduce ? "1" : "";
    }
    if (s.reduce) {
      f.style.transform = "";
      f.style.opacity = String(1 - clamp(s.p / 0.5));
    } else {
      f.style.opacity = "";
      f.style.transformOrigin = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      f.style.transform = zp === 0 ? "" : `scale(${z.toFixed(4)})`;
    }
    const done = s.reduce ? s.p >= 0.5 : zp >= 1;
    f.style.visibility = done ? "hidden" : "";
    if (ui.current) {
      ui.current.style.opacity = String(1 - clamp(s.p / 0.06));
      ui.current.style.visibility = s.p > 0.06 ? "hidden" : "";
    }
    // A little way back before the words go dark, so a reader resting at the edge doesn't flicker them.
    if (done) reveal(s.reduce ? 0 : 750);
    else if (s.reduce ? s.p < 0.42 : zp < 0.97) conceal();
  };

  const measure = () => {
    const sec = section.current;
    const st = stage.current;
    if (!sec || !st) return;
    s.reduce = reducedMotion();
    s.vw = innerWidth;
    s.vh = innerHeight;
    s.W = st.clientWidth;
    s.H = st.clientHeight;
    // After the push and the words, the words keep the screen a while before the page moves on.
    s.hold = s.reduce ? 0 : Math.round(innerHeight * 0.95);
    s.dist = Math.round(innerHeight * 1.6);
    sec.style.height = `${s.H + s.dist + s.hold}px`;
    s.top = sec.getBoundingClientRect().top + scrollY;
    fit();
    draw();
  };

  const roll = (t: number) => {
    s.raf = 0;
    if (!s.rolling) return;
    const dt = Math.min(0.05, (t - (s.last || t)) / 1000);
    s.last = t;
    s.speed = Math.min(1, s.speed + dt / 0.4);
    s.angle += s.speed * s.speed * 0.55 * 360 * dt;
    turnReels();
    draw();
    s.raf = requestAnimationFrame(roll);
  };
  const startRolling = () => {
    if (s.rolling || s.parking || !s.ready || s.reduce) return;
    s.rolling = true;
    s.last = 0;
    if (!s.raf) s.raf = requestAnimationFrame(roll);
  };
  // The first scroll parks a window at the top, at the reels' own speed, for the push through it.
  const park = () => {
    s.rolling = false;
    const a0 = s.angle;
    const w = Math.max(40, s.speed * 0.55 * 360);
    const target = Math.ceil((a0 + w * 0.1) / WINDOW) * WINDOW;
    s.speed = 0;
    s.parking = true;
    void tween(
      clamp(((3 * (target - a0)) / w) * 1000, 220, 420),
      (e) => {
        s.angle = a0 + (target - a0) * e;
        turnReels();
        draw();
      },
      outCubic,
    ).then(() => {
      s.angle = target % 360;
      turnReels();
      s.parking = false;
    });
  };

  useLayoutEffect(() => {
    measure();
    // The title loads in rack focus, once, then the reels start to roll.
    if (!s.started) {
      s.started = true;
      rackFocus(Array.from(mark.current?.querySelectorAll(".wl") ?? []), { stagger: 70, duration: 900, scale: 1.06, blur: 14 });
    }
    if (s.ready) return;
    const ready = setTimeout(
      () => {
        s.ready = true;
        if (s.p < 0.012) startRolling();
      },
      s.reduce ? 0 : 1100,
    );
    return () => clearTimeout(ready);
    // Mount only: the scene keeps its own state in `s`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The headline is fitted in its own face, so fit again once the faces are in.
    document.fonts?.ready.then(() => !cancelled && fit());
    return () => {
      cancelled = true;
      s.rolling = false;
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useScrollFrame((y) => {
    // A phone's address bar coming and going changes the height a little: only a real resize lays the scene out again.
    if (innerWidth !== s.vw || Math.abs(innerHeight - s.vh) > 150) measure();
    s.p = s.dist ? clamp((y - s.top) / s.dist) : 1;
    if (s.p < 0.012) {
      if (s.ready) startRolling();
    } else if (s.rolling && !s.parking) park();
    draw();
  });

  return (
    <section ref={section} className="intro" aria-label="itsgiving" data-dark="">
      <div ref={stage} className="intro-stage">
        <div className="hero">
          <div className="hero-wrap">
            <h1 ref={heading} className="hero-h">
              <span className="hero-line">
                <span className="hero-w">your</span> <span className="hero-w">voice,</span>
              </span>{" "}
              <span className="hero-line">
                <span className="hero-w">their</span> <span className="hero-w">taste.</span>
              </span>
            </h1>
          </div>
        </div>
        <div ref={film} className="intro-film" aria-hidden>
          <div ref={hole} className="intro-hole" style={holeStyle} />
          <div ref={mark} className="intro-mark" style={markStyle}>
            <Lettermark letters className="block size-full" />
          </div>
        </div>
        <div ref={ui} className="intro-ui surface-dark">
          <p className="intro-cue" aria-hidden>
            Scroll
            <i />
          </p>
        </div>
      </div>
    </section>
  );
}
