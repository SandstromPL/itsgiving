"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Treatment } from "@/lib/agent/types";
import { eraOf, eraStyle, noEraLine, suggestEra, type Era, type EraId } from "./eras";
import { useLingo } from "./lingo";
import type { EraPick } from "./title-card";
import "./eras.css";

/** How long each era's moment runs (eras.css), so the layer puts it away once it has played. */
const MOMENT_MS: Record<EraId, number> = { bombay75: 1100, paris60: 900, hongkong94: 900, hollywood54: 1400 };

/**
 * A board's era: none until the director picks one in the title-card window (like the face, it's theirs for the visit),
 * the one the audience points to, and what the board's article wears for it. Picking an era sets its face too.
 */
export function useEra(
  t: Treatment,
  setFace: (id: string) => void,
): { pick: EraPick; wear: { "data-era"?: EraId; style?: CSSProperties } } {
  const [id, setId] = useState<EraId | null>(null);
  return {
    pick: {
      id,
      suggestion: suggestEra(t),
      none: noEraLine(t),
      mock: t.mock.qloo,
      onPick: (next) => {
        setId(next);
        if (next) setFace(eraOf(next).font);
      },
    },
    wear: { "data-era": id ?? undefined, style: eraStyle(id ? eraOf(id) : null) },
  };
}

/**
 * An era on the cover (eras.ts): a texture over the still, two stickers and the credit to the tradition, and once, when
 * the era is picked, its moment. It sits in the cover's column between the top row and the words, so the stickers and
 * the credit never cover the title; the texture and the moment fill the whole frame.
 */
export function EraLayer({ id, title }: { id: EraId | null; title: string }) {
  const { unc } = useLingo();
  const era: Era | null = id ? eraOf(id) : null;
  // The moment answers a pick: a board that opens in an era, or comes back into view, doesn't play it again.
  const [shown, setShown] = useState(id);
  const [moment, setMoment] = useState<EraId | null>(null);
  if (id !== shown) {
    setShown(id);
    setMoment(id);
  }
  useEffect(() => {
    if (!moment) return;
    const done = setTimeout(() => setMoment(null), MOMENT_MS[moment] + 100);
    return () => clearTimeout(done);
  }, [moment]);
  if (!era) return null;
  return (
    <div key={era.id} data-era-layer={era.id} data-moment={moment ?? undefined} className="era-layer flex flex-col items-end gap-2.5">
      <span aria-hidden className="era-texture" />
      <ul aria-hidden className="flex flex-wrap justify-end gap-2.5">
        {era.stickers.map((sticker, i) => (
          <li
            key={sticker.genz}
            className={`rounded-xl px-3.5 py-2 text-[15px] leading-5 font-bold ring-1 ring-white/25 ${i === 0 ? "-rotate-3" : "rotate-2"}`}
            style={{ background: era.colors.stickers[i].ground, color: era.colors.stickers[i].ink }}
          >
            {unc ? sticker.unc : sticker.genz}
          </li>
        ))}
      </ul>
      <p
        className="max-w-[25rem] rounded-[19px] bg-black/70 px-3.5 py-2 text-right text-[13px] leading-5"
        style={{ color: era.colors.title }}
      >
        {era.credit}
      </p>
      {moment === "paris60" && <Intertitle era={era} title={title} />}
      {moment === "hollywood54" && <Curtain />}
    </div>
  );
}

/** Paris '60's moment: a cut to an intertitle, the title's words in capitals on black, red, white and blue in turn. */
function Intertitle({ era, title }: { era: Era; title: string }) {
  const inks = [era.colors.stickers[0].ink, era.colors.title, era.colors.stickers[1].ink];
  return (
    <div aria-hidden className="era-moment era-intertitle">
      <p>
        {title
          .split(/\s+/)
          .filter(Boolean)
          .map((word, i) => (
            <span key={i} style={{ color: inks[i % inks.length] }}>
              {word}{" "}
            </span>
          ))}
      </p>
    </div>
  );
}

/** Hollywood '54's moment: a picture palace's curtain parts on the cover. */
function Curtain() {
  return (
    <div aria-hidden className="era-moment era-curtain">
      <span />
      <span />
    </div>
  );
}
