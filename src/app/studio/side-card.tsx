"use client";

import { useCallback, useId, useRef, type ReactNode } from "react";
import { aboveBudget, budgetPhrase, joinNames, priceLine, withYear } from "@/lib/agent/options";
import type { Character, Treatment } from "@/lib/agent/types";
import type { KnownRole } from "@/lib/tmdb";
import { QlooNote, Still, Why } from "./parts";
import { evidenceTone } from "./ui";

// The small card that slides in from the right over a board (board.css): a character's face, or a wardrobe brand.
// Named things open it; the board's rows keep only the writing.

/** "Calum in Aftersun (2022) and Lucius in Gladiator II (2024)". */
export const knownAs = (roles: KnownRole[]) => joinNames(roles.map((role) => `${role.character} in ${withYear(role.title, role.year)}`));

/**
 * The card: a dialog in the top layer (a popover, put away by a click outside). Opening it moves focus to its Close
 * button; Escape or Close put it away and give focus back to the name that opened it. A wheel or a swipe inside it
 * scrolls the card, never the page behind (data-lenis-prevent). Never printed: the board prints these facts in place.
 */
function SideCard({
  id,
  kicker,
  title,
  picture,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  picture?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  const close = useRef<HTMLButtonElement>(null);
  // React doesn't write `autofocus` into the page, so the popover can't find it: focus moves in when it opens.
  const watch = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") close.current?.focus({ preventScroll: true });
    };
    el.addEventListener("toggle", toggled);
    return () => el.removeEventListener("toggle", toggled);
  }, []);
  return (
    <div ref={watch} id={id} popover="auto" role="dialog" aria-labelledby={heading} data-lenis-prevent className="side-card print:hidden">
      <div className="relative flex flex-col gap-2.5">
        <button
          ref={close}
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          aria-label="Close"
          className="absolute top-2 right-2 z-10 grid size-10 place-items-center rounded-full bg-black/60 text-subhead leading-none text-white ring-1 ring-white/30"
        >
          <span aria-hidden>×</span>
        </button>
        {picture}
        <p className="mt-1.5 px-1.5 text-caption font-semibold text-faint">{kicker}</p>
        <h3 id={heading} className="type-head px-1.5 pr-12 text-title leading-[1.05]">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

/** A name that opens its card: the name itself, with a small mark after it so it reads as more than text. */
export function NameButton({ card, icon, children }: { card: string; icon: "face" | "look"; children: ReactNode }) {
  return (
    <button type="button" popoverTarget={card} aria-haspopup="dialog" className="namebtn">
      {children}
      <span aria-hidden className="nb">
        {icon === "face" ? (
          <svg viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="5" r="3.2" />
            <path d="M2 15c0-3.6 2.7-5.6 6-5.6s6 2 6 5.6z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M5.5 2 2 4.5l1.6 3 1.4-.8V14h6V6.7l1.4.8 1.6-3L10.5 2C10 3.2 9.1 3.8 8 3.8S6 3.2 5.5 2z" />
          </svg>
        )}
      </span>
    </button>
  );
}

const line = "px-1.5 text-small leading-normal text-dim";

/** A character's face: the actor's portrait (Qloo's, else TMDB's), the parts TMDB knows them for, Qloo's receipt, the part. */
export function FaceCard({ id, c, t, mock }: { id: string; c: Character; t: Treatment; mock: boolean }) {
  const face = c.face;
  if (!face) return null;
  return (
    <SideCard
      id={id}
      kicker={`A face for ${c.name}`}
      title={face.entity.name}
      picture={
        <Still
          src={face.entity.image ?? face.photo}
          alt={`Photo of ${face.entity.name}`}
          className="aspect-[4/5] max-h-[46dvh] w-full rounded-[18px] object-[50%_22%]"
        />
      }
    >
      {face.known.length > 0 && <p className={line}>Known as {knownAs(face.known)}, per TMDB.</p>}
      {face.photo && !face.entity.image && <p className={line}>Photo: TMDB</p>}
      <Why
        label="why this face"
        name={face.entity.name}
        qloo={face.qloo}
        of="actors"
        read={[{ term: "The part", text: c.presence }]}
        writtenBy={t.writtenBy}
        mock={mock}
        className="mt-1"
      />
      {c.presence && (
        <p className={line}>
          <span className="font-semibold text-foreground">The part.</span>{" "}
          <span className="font-serif text-lead leading-snug">{c.presence}</span>
        </p>
      )}
    </SideCard>
  );
}

/** A wardrobe brand: Qloo's picture of it, its traits and prices, Qloo's style sentence, the look itsgiving wrote, the receipt. */
export function BrandCard({ id, w, t, mock }: { id: string; w: Treatment["wardrobe"][number]; t: Treatment; mock: boolean }) {
  const brand = w.entity.brand;
  const price = priceLine(brand?.price);
  const reference = aboveBudget(w.entity, t.brief.budget);
  return (
    <SideCard
      id={id}
      kicker="Wardrobe reference"
      title={w.entity.name}
      picture={
        w.entity.image ? (
          <div className="grid aspect-[4/3] max-h-[34dvh] w-full place-items-center overflow-hidden rounded-[18px] bg-white">
            <Still
              src={w.entity.image}
              alt={`${w.entity.name}, as ${mock ? "the mock" : "Qloo"} shows it`}
              className="size-full object-contain!"
            />
          </div>
        ) : undefined
      }
    >
      {brand?.traits && brand.traits.length > 0 && (
        <p className={`px-1.5 font-mono text-label leading-5 ${evidenceTone(mock)}`}>{brand.traits.join(" / ")}</p>
      )}
      {price && (
        <p className={line}>
          {price}
          {reference && `, above ${budgetPhrase(t.brief.budget)}: rent it or match it`}
        </p>
      )}
      <div className="px-1.5">
        <QlooNote text={brand?.style} mock={mock} max={320} />
      </div>
      <p className="px-1.5 font-serif text-lead leading-snug">{w.notes.look}</p>
      <Why
        label="why this brand"
        name={w.entity.name}
        qloo={w.qloo}
        facts={[
          { term: "Style", text: brand?.style },
          { term: "Prices", text: price },
        ]}
        read={[{ term: "The look", text: w.notes.look }]}
        writtenBy={t.writtenBy}
        mock={mock}
        className="mt-1"
      />
    </SideCard>
  );
}
