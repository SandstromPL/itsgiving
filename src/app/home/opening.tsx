"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { LETTERMARK_BOX, Lettermark, lettermarkPortal } from "../marks";
import { scrollToY, useScrollFrame } from "../smooth";
import { INTRO_KEY } from "../studio/theme-script";
import { clamp, outCubic, rackFocus, reducedMotion, tween } from "./motion";
import "./home.css";

// The homepage's first screen. A first visit gets the title card: the 2B lettermark on black, loaded in 1B rack focus,
// its reels rolling. Scrolling parks a window of the second g at the top and dollies through it until the window is the
// screen; after a beat of black, "your voice, their taste." racks into focus word by word and holds the screen. It's all
// the scroll's, both ways and at any speed: the words sharpen as far as the reader has scrolled, so a fast scroll can't
// leave them behind, and scrolling back up blurs them out and pulls back out of the window to the card. Skip intro jumps
// to the words. Once someone has reached the words, their next visits open on the headline, racked in once, with a way
// to play the intro again. Under reduced motion the card fades out instead and the words fade in.

/** Whether this browser has been through the intro before (the head script reads the same key, theme-script.ts). */
function seenBefore() {
  try {
    return localStorage.getItem(INTRO_KEY) === "seen";
  } catch {
    return false;
  }
}
function remember(seen: boolean) {
  try {
    if (seen) localStorage.setItem(INTRO_KEY, "seen");
    else localStorage.removeItem(INTRO_KEY);
  } catch {
    // storage blocked: the intro plays on every visit
  }
}

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

/**
 * Where each word racks into focus, as a share of the scroll that follows the push: a beat of black, then the four
 * words one after another, sharp a little past halfway, so the rest of it holds them. Under reduced motion, where
 * nothing follows the push, a share of the push's own scroll once the card has faded.
 */
const WORDS = { start: 0.05, step: 0.09, span: 0.26 };
const FADES = { start: 0.52, step: 0.03, span: 0.2 };

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
  const skipButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headerAt = useRef<HTMLSpanElement>(null);
  const s = useRef({
    /** Whether the title card plays: decided once per page, so Back to a page Next kept keeps the layout it left. */
    on: null as boolean | null,
    /** This visit has reached the words (or skipped to them), so the next visit opens on them. */
    marked: false,
    skip: true,
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
    /** How far through the push (0 to 1), and through the scroll that holds the words after it. */
    p: 0,
    q: 0,
    angle: 0,
    speed: 0,
    rolling: false,
    ready: false,
    parking: false,
    /** Each word's focus as last drawn, so a frame that changes nothing writes nothing. */
    focus: [] as number[],
    raf: 0,
    last: 0,
  }).current;

  // Fill the width with the two lines, as the words alone (the size is fitted, like a title card's), measured at their
  // own size: a word still racking in is drawn a little large.
  const fit = () => {
    const h = heading.current;
    const box = h?.parentElement;
    if (!h || !box) return;
    const words = Array.from(h.querySelectorAll<HTMLElement>(".hero-w"));
    const scaled = words.map((word) => word.style.transform);
    words.forEach((word) => (word.style.transform = ""));
    h.style.fontSize = "100px";
    const widest = Math.max(
      ...Array.from(h.querySelectorAll(".hero-line"), (line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return range.getBoundingClientRect().width;
      }),
    );
    words.forEach((word, i) => (word.style.transform = scaled[i]));
    const cs = getComputedStyle(box);
    const room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (widest > 0) h.style.fontSize = `${Math.floor(Math.min((room / widest) * 100 * 0.99, 300))}px`;
  };

  const turnReels = () => {
    mark.current?.querySelectorAll<SVGGElement>("[data-reel]").forEach((g) => {
      g.setAttribute("transform", `rotate(${s.angle.toFixed(2)} ${g.dataset.c ?? ""})`);
    });
  };

  /**
   * 1B rack focus, as far as the scroll has come: each word from dark, blurred and a little large, to sharp. While a
   * word racks in it is a layer of its own, so the compositor blurs and scales it instead of the page repainting 300px
   * type on every frame (about a tenth less raster work on a phone); unseen or sharp, it's plain text.
   */
  const focusWords = () => {
    heading.current?.querySelectorAll<HTMLElement>(".hero-w").forEach((word, i) => {
      const at = s.reduce ? FADES : WORDS;
      const e = outCubic(clamp(((s.reduce ? s.p : s.q) - at.start - i * at.step) / at.span));
      if (s.focus[i] === e) return;
      s.focus[i] = e;
      const soft = !s.reduce && e < 1;
      word.style.opacity = e.toFixed(3);
      word.style.filter = soft ? `blur(${(18 * (1 - e)).toFixed(2)}px)` : "";
      word.style.transform = soft ? `scale(${(1.06 - 0.06 * e).toFixed(4)})` : "";
      word.style.willChange = soft && e > 0 ? "transform, filter, opacity" : "";
    });
  };
  const place = (y: number) => {
    s.p = s.dist ? clamp((y - s.top) / s.dist) : 1;
    s.q = s.hold ? clamp((y - s.top - s.dist) / s.hold) : 0;
  };

  const draw = () => {
    const f = film.current;
    if (!s.on || !s.W || !f) return;
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
    // Skip stays until the push is through (until the words have faded in, under reduced motion); the words reached,
    // later visits open on them.
    const skip = s.p < (s.reduce ? 0.8 : 1);
    if (skip !== s.skip && skipButton.current) {
      s.skip = skip;
      skipButton.current.hidden = !skip;
    }
    focusWords();
    if (!s.marked && (s.reduce ? s.p >= 0.85 : s.q >= 0.6)) {
      s.marked = true;
      remember(true);
    }
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
    // After the push, the scroll that racks the words in and then keeps them on the screen before the page moves on. A
    // returning visitor's headline is a screen of its own.
    s.hold = s.reduce || !s.on ? 0 : Math.round(innerHeight * 1.1);
    s.dist = s.on ? Math.round(innerHeight * 1.6) : 0;
    sec.style.height = `${s.H + s.dist + s.hold}px`;
    // Where the site header comes in (it waits for this mark to reach the top): as the first word racks in; under
    // reduced motion once the words have faded in, when Skip goes from the corner the header takes. A returning
    // visitor's headline has it at once.
    const at = !s.on ? 0 : s.reduce ? s.dist * 0.8 : s.dist + s.hold * WORDS.start;
    if (headerAt.current) headerAt.current.style.top = `${Math.round(at)}px`;
    s.top = sec.getBoundingClientRect().top + scrollY;
    place(scrollY);
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
    const sec = section.current;
    if (s.on === null && sec) {
      s.on = !seenBefore();
      if (!s.on) {
        sec.dataset.off = "";
        delete sec.dataset.dark;
      }
    }
    measure();
    // The title loads in rack focus, once, then the reels start to roll. A returning visitor's headline racks in instead.
    if (!s.started) {
      s.started = true;
      if (s.on) rackFocus(Array.from(mark.current?.querySelectorAll(".wl") ?? []), { stagger: 70, duration: 900, scale: 1.06, blur: 14 });
      else
        rackFocus(Array.from(heading.current?.querySelectorAll(".hero-w") ?? []), {
          stagger: 90,
          duration: 900,
          scale: 1,
          blur: 14,
          delay: 120,
        });
    }
    if (s.ready || !s.on) return;
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
    if (!s.on) return;
    place(y);
    if (s.p < 0.012) {
      if (s.ready) startRolling();
    } else if (s.rolling && !s.parking) park();
    draw();
  });

  // Straight to the words, sharp: past the push, where the last word has racked in (faded in, under reduced motion).
  const skip = () => {
    const top = s.reduce ? s.top + Math.round(s.dist * 0.85) : s.top + s.dist + Math.round(s.hold * 0.62);
    scrollToY(top);
    s.marked = true;
    remember(true);
    const h = heading.current;
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  };
  // The whole intro again, from the top: the page opens as it does on a first visit.
  const replay = () => {
    remember(false);
    window.scrollTo(0, 0);
    window.location.reload();
  };

  return (
    <section ref={section} className="intro" aria-label="itsgiving" data-dark="">
      <span ref={headerAt} id="headline-at" aria-hidden className="intro-at" />
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
        <button ref={skipButton} type="button" className="intro-skip surface-dark press" onClick={skip}>
          Skip intro
        </button>
        <button type="button" className="intro-replay press" onClick={replay}>
          Play the intro
        </button>
      </div>
    </section>
  );
}
