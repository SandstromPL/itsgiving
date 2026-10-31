import { CAMERA, cameraMarkup, cameraPortal } from "./marks";

// The camera cut: a board opens through the camera's window (2C). The frame goes dark with the camera in the middle,
// its reels run up to speed like a motor, a window parks at the top, and the shot pushes through it until the window
// is the screen, with the new page behind it. A finished build is slated first: the slate fills the frame, claps, and
// is pulled up out of it as on set while the camera comes in. Drawn on two fixed layers added to <body> once, outside
// React, so the cut carries on across a client navigation. Under reduced motion it's a short fade through the frame.

export interface Slate {
  scene: string;
  take: number;
  /** dd.mm.yy */
  date: string;
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = {
  inQuad: (t: number) => t * t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

async function tween(ms: number, step: (eased: number, t: number) => void, curve: (t: number) => number = (t) => t) {
  const start = performance.now();
  for (;;) {
    const now = await frame();
    const t = ms <= 0 ? 1 : clamp((now - start) / ms);
    step(curve(t), t);
    if (t >= 1) return;
  }
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Today as a slate writes it: 31.10.26. */
export function slateDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}`;
}

/* ---------- The slate, in the marks' language ---------- */

const STICK_OPEN = -11;
// Asset 1's clap: shut in 40% of 275 ms, a small bounce, then shut. 1 is open, 0 is shut.
const clapCurve = (t: number) => (t < 0.4 ? (1 - t / 0.4) ** 1.6 : t < 0.66 ? 0.15 * Math.sin(((t - 0.4) / 0.26) * Math.PI) : 0);

function slateMarkup({ scene, take, date }: Slate) {
  const mark = token("--mark");
  const ink = token("--mark-tile");
  const stripes = (y0: number, y1: number, lean: number) =>
    Array.from({ length: 7 }, (_, i) => `<path d="M${9 + i * 13.4} ${y0}h6.4l${-lean} ${y1 - y0}h-6.4z" fill="${ink}"/>`).join("");
  return (
    `<svg class="slate-sticks" viewBox="0 0 100 15.5" aria-hidden="true"><rect x="0" y="8.4" width="100" height="7.1" rx="1.6" fill="${mark}"/>${stripes(8.4, 15.5, 4.2)}` +
    `<g data-stick transform="rotate(${STICK_OPEN} 1.6 7.9)"><rect x="0" y="0.6" width="100" height="7.1" rx="1.6" fill="${mark}"/>${stripes(0.6, 7.7, -4.2)}</g><circle cx="4.4" cy="9.6" r="1.5" fill="${ink}"/></svg>` +
    `<div class="slate-board"><div class="slate-row"><span class="k">Prod.</span><span class="v">itsgiving</span></div>` +
    `<div class="slate-row slate-row--3"><div><span class="k">Roll</span><span class="v">a001</span></div><div><span class="k">Scene</span><span class="v v--big">${esc(scene)}</span></div><div><span class="k">Take</span><span class="v v--big">${take}</span></div></div>` +
    `<div class="slate-row slate-row--2"><div><span class="k">Director</span><span class="v">you</span></div><div><span class="k">Date</span><span class="v">${esc(date)}</span></div></div></div>`
  );
}

/* ---------- The layers ---------- */

let layers: { svg: SVGSVGElement; take: HTMLDivElement } | null = null;
function ensureLayers() {
  if (layers?.svg.isConnected) return layers;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "cut-layer");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("hidden", "");
  const take = document.createElement("div");
  take.className = "take-layer";
  take.setAttribute("aria-hidden", "true");
  take.hidden = true;
  document.body.append(svg, take);
  layers = { svg, take };
  return layers;
}

/** The slate fills the frame, claps, and is pulled up out of it; `pulled` runs as the pull starts. */
async function slateScene(take: HTMLDivElement, info: Slate, pulled?: () => void) {
  take.innerHTML = `<div class="slate-card">${slateMarkup(info)}</div>`;
  take.hidden = false;
  const card = take.firstElementChild as HTMLDivElement;
  const stick = take.querySelector("[data-stick]")!;
  const set = (k: number) => stick.setAttribute("transform", `rotate(${(STICK_OPEN * k).toFixed(2)} 1.6 7.9)`);
  if (reduced()) {
    card.style.opacity = "0";
    await tween(200, (e) => (card.style.opacity = String(e)));
    await wait(450);
    set(0);
    await wait(520);
    pulled?.();
    await tween(220, (e) => (card.style.opacity = String(1 - e)));
  } else {
    await tween(
      380,
      (e) => {
        card.style.opacity = String(e);
        card.style.transform = `translateY(${((1 - e) * 40).toFixed(1)}px) scale(${(0.95 + 0.05 * e).toFixed(4)})`;
      },
      ease.outCubic,
    );
    await wait(380);
    await tween(275, (_, t) => set(clapCurve(t)));
    await wait(340);
    const rise = innerHeight / 2 + card.getBoundingClientRect().height;
    pulled?.();
    await tween(
      440,
      (e) => (card.style.transform = `translateY(${(-rise * e).toFixed(1)}px) rotate(${(-2.5 * e).toFixed(2)}deg)`),
      ease.inCubic,
    );
  }
  take.hidden = true;
  take.innerHTML = "";
}

let running = false;

/** Whether a cut is playing (a second click waits for it rather than starting another). */
export const cutBusy = () => running;

/**
 * Plays the cut. `go` swaps the page underneath while the frame is dark (a navigation, or a board shown in place); the
 * window opens once it has finished, or after 3 s at most. With `slate`, the slate claps first.
 */
export async function playCut(go: () => unknown, { slate }: { slate?: Slate } = {}) {
  if (running) return;
  running = true;
  const { svg, take } = ensureLayers();
  const settle = (work: unknown) => Promise.race([Promise.resolve(work).catch(() => {}), wait(3000)]);
  try {
    svg.removeAttribute("hidden");
    const W = innerWidth;
    const H = innerHeight;
    const ink = token("--frame") || "#0a0a0a";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (reduced()) {
      svg.innerHTML = `<rect width="${W}" height="${H}" fill="${ink}"/>`;
      await tween(140, (e) => (svg.style.opacity = String(e)));
      if (slate) await slateScene(take, slate);
      await settle(go());
      await tween(220, (e) => (svg.style.opacity = String(1 - e)));
      return;
    }
    const [bx, by, bw, bh] = CAMERA.box;
    const k = Math.min((H * 0.3) / bh, (W * 0.44) / bw);
    const tx = W / 2 - (bx + bw / 2) * k;
    const ty = H / 2 - (by + bh / 2) * k;
    svg.innerHTML =
      `<defs><mask id="cut-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><circle data-hole r="0" fill="#000"/></mask></defs>` +
      `<g mask="url(#cut-hole)"><rect width="${W}" height="${H}" fill="${ink}"/><g data-zoom><g data-cam${slate ? ' opacity="0"' : ""}><g transform="matrix(${k} 0 0 ${k} ${tx} ${ty})">${cameraMarkup(token("--mark") || "#e4ff3a", ink)}</g></g></g></g>`;
    const hole = svg.querySelector("[data-hole]")!;
    const zoom = svg.querySelector("[data-zoom]")!;
    const cam = svg.querySelector("[data-cam]")!;
    const reels = Array.from(svg.querySelectorAll("[data-reel]"));
    let angle = 0;
    let speed = 0;
    let z = 1;
    let peek = 0;
    let last = performance.now();
    let spinning = true;
    const draw = () => {
      reels[0].setAttribute("transform", `rotate(${angle.toFixed(2)} 21 23)`);
      reels[1].setAttribute("transform", `rotate(${(angle * CAMERA.ratio).toFixed(2)} 38.5 25)`);
      const p = cameraPortal(angle);
      const x = tx + p.cx * k;
      const y = ty + p.cy * k;
      zoom.setAttribute("transform", z === 1 ? "" : `translate(${x} ${y}) scale(${z}) translate(${-x} ${-y})`);
      hole.setAttribute("cx", x.toFixed(2));
      hole.setAttribute("cy", y.toFixed(2));
      hole.setAttribute("r", (p.r * k * z * peek).toFixed(2));
    };
    void (async () => {
      while (spinning) {
        const now = await frame();
        angle += (speed * 0.85 * 360 * (now - last)) / 1000;
        last = now;
        draw();
      }
    })();
    svg.style.opacity = "0";
    draw();
    await tween(slate ? 220 : 160, (e) => (svg.style.opacity = String(e)), ease.outCubic);
    const swapped = settle(go());
    if (slate) {
      // The camera comes in as the slate leaves the frame.
      let arriving: Promise<void> | null = null;
      await slateScene(take, slate, () => {
        arriving = tween(
          460,
          (e) => {
            cam.setAttribute("opacity", e.toFixed(3));
            const s = 0.82 + 0.18 * e;
            cam.setAttribute("transform", `translate(${W / 2} ${H / 2}) scale(${s.toFixed(4)}) translate(${-W / 2} ${-H / 2})`);
          },
          ease.outCubic,
        );
      });
      await arriving;
      cam.removeAttribute("transform");
      await wait(160);
    }
    await swapped;
    // Roll: up to speed like a motor, and the window opens on the next screen.
    await tween(320, (e) => ((speed = e), (peek = e)), ease.inQuad);
    await wait(160);
    // Park a window at the top, then push through it until it is the screen.
    const a0 = angle;
    const w = Math.max(60, speed * 0.85 * 360);
    const target = Math.ceil((a0 + w * 0.12) / CAMERA.spacing) * CAMERA.spacing;
    speed = 0;
    await tween(clamp(((3 * (target - a0)) / w) * 1000, 240, 460), (e) => (angle = a0 + (target - a0) * e), ease.outCubic);
    const p = cameraPortal(angle);
    const px = tx + p.cx * k;
    const py = ty + p.cy * k;
    const far = Math.max(Math.hypot(px, py), Math.hypot(W - px, py), Math.hypot(px, H - py), Math.hypot(W - px, H - py));
    const zMax = (far / (p.r * k)) * 1.05;
    await tween(600, (e) => (z = Math.exp(Math.log(zMax) * e)), ease.inOutCubic);
    spinning = false;
  } finally {
    svg.setAttribute("hidden", "");
    svg.innerHTML = "";
    svg.style.opacity = "";
    take.hidden = true;
    take.innerHTML = "";
    running = false;
  }
}

/** Plays the cut into another page: `router.push(href)` under the dark frame, the window opening once it has landed. */
export function cutTo(router: { push(href: string): void }, href: string) {
  return playCut(async () => {
    const target = new URL(href, location.href);
    router.push(href);
    const start = performance.now();
    while (location.pathname !== target.pathname && performance.now() - start < 3000) await frame();
    // Two frames for the new page to paint.
    await frame();
    await frame();
  });
}

/** For a link's click: plays the cut on a plain left click; a modified click (new tab, new window) goes as usual. */
export function cutClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
}) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  return true;
}
