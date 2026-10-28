"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NUDGES,
  NUDGE_LABELS,
  audiencePhrase,
  coverReference,
  excerpt,
  tagLabel,
  tmdbSize,
  withoutIdentity,
  type Nudge,
} from "@/lib/agent/options";
import type { LlmStep, Treatment } from "@/lib/agent/types";
import type { CompactEntity, CompactTag } from "@/lib/qloo/normalize";
import { PINNED, ShootBaseBlock, locationPins } from "./base-map";
import { useEra } from "./era-layer";
import { useLingo } from "./lingo";
import { QlooTags, Still, Tape, Why, modelName } from "./parts";
import { type CoverStill } from "./title-card";
import { suggestTitleFont } from "./title-fonts";
import { evidenceTone, outlineButton, paperEvidence } from "./ui";
import { afterLabel, listWithYears } from "@/lib/text";
import { Cover, PaletteSwatches } from "./cover";
import { SectionBar } from "./section-bar";
import { FilmEdge, Interval, dateStamp } from "./board-cut";
import { printPicture, printRead, printReceipt, printRow, usePrintTitle } from "./board-print";

const STEP_NAME: Record<LlmStep, string> = { plan: "Plan", replan: "Re-plan", write: "Writing" };

/** itsgiving's own writing is set in the serif; the tool, labels and Qloo's evidence stay in the interface faces. */
const prose = "font-serif text-[1.25rem] leading-[1.38]";
/** A card is never cut across two printed pages. */
const card = "rounded-[26px] border border-line bg-card print:break-inside-avoid";

/**
 * A grid of n cards with no hole in its last row: two columns, three from xl when the count allows, and one card (the
 * first or the last) spanning two where the count is odd for the columns. A spanning card's picture goes widescreen.
 */
function fill(n: number, at: "first" | "last"): { grid: string; span: (i: number) => string; wide: (i: number) => string } {
  // Four (or seven) cards sit better as pairs than as a row of three with one left over.
  const three = n % 3 !== 1;
  const sm = n % 2 === 1 ? "sm:col-span-2" : "";
  const xl = !three ? "" : n % 3 === 2 ? "xl:col-span-2" : sm ? "xl:col-span-1" : "";
  const wide = [sm && "sm:aspect-[2.39/1]", xl === "xl:col-span-2" ? "xl:aspect-[2.39/1]" : xl && "xl:aspect-video"]
    .filter(Boolean)
    .join(" ");
  const target = at === "first" ? 0 : n - 1;
  return {
    grid: three ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2",
    span: (i) => (i === target ? `${sm} ${xl}`.trim() : ""),
    wide: (i) => (i === target ? wide : ""),
  };
}

/** A section starts a new printed page, unless it `follows` the one before (the short ones at the end share a page). */
function Section({
  id,
  title,
  note,
  follows = false,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  follows?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-6 ${follows ? "" : "print:break-before-page"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 print:break-after-avoid">
        {/* The section bar's jump lands on the heading, so the room it leaves for the sticky bar is the heading's. */}
        <h2 id={id} className="type-head scroll-mt-24 text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          {title}
        </h2>
        {note && <p className="max-w-[60ch] text-[15px] leading-6 text-faint">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function EvidenceChips({ tags, mock, shared }: { tags: CompactTag[]; mock: boolean; shared?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className={`rounded-full px-3 py-1.5 font-mono text-[13px] ${
            shared ? "bg-accent font-semibold text-ink" : `border border-dashed border-slip-edge bg-slip ${paperEvidence(mock)}`
          }`}
        >
          {tagLabel(tag.name)}
        </li>
      ))}
    </ul>
  );
}

function Also({ label, items, mock }: { label: string; items: CompactEntity[]; mock: boolean }) {
  if (items.length === 0) return null;
  return (
    <p className="text-[15px] leading-6 text-dim">
      {label} <span className={`font-mono text-[13px] ${evidenceTone(mock)}`}>{listWithYears(items)}</span>
    </p>
  );
}

/** The treatment's tone tags, without any that name who people are (isIdentityTag): older builds can carry them. */
const toneOf = (t: Treatment) => withoutIdentity(t.tone, (tone) => tone.tag.name);

/**
 * "it's giving": the tone tags Qloo found, with the ones the director's own films share highlighted. `whose` says
 * whose films: "your" in the studio, "the director's" on an example someone else briefed.
 */
function Giving({ t, mock, whose }: { t: Treatment; mock: boolean; whose: string }) {
  const lingo = useLingo().t;
  const tone = toneOf(t);
  if (tone.length === 0) return null;
  const shared = tone.filter((x) => x.source === "overlap").length;
  // Lime picks out the tags the director's films share. When they all do, picking them out says nothing: the caption
  // says it instead, and the row stays plain.
  const mark = shared > 0 && shared < tone.length;
  return (
    <section aria-labelledby="giving-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id="giving-title" className="mr-2 font-serif text-[clamp(2.5rem,4.5vw,3.25rem)] leading-none font-normal italic">
          {lingo.giving}
        </h2>
        {tone.map((x) => (
          <span
            key={x.tag.id}
            className={
              mark && x.source === "overlap"
                ? "rounded-full bg-accent px-4 py-2.5 text-[17px] font-bold text-ink"
                : "rounded-full border border-line bg-card px-4 py-2.5 text-[17px]"
            }
          >
            {tagLabel(x.tag.name)}
            {mark && x.source === "overlap" && <span className="sr-only"> ({lingo.shared(whose)})</span>}
          </span>
        ))}
        {mock && <Tape>Mock data</Tape>}
      </div>
      <p className="text-[15px] text-faint">
        Tone tags from {mock ? "the synthetic mock, not Qloo" : "Qloo"}: what this audience over-indexes on.
        {mark ? ` Highlighted: shared with ${whose} films.` : shared > 0 ? ` All of them are shared with ${whose} films.` : ""}
      </p>
    </section>
  );
}

/**
 * The rework bar: the nudges that re-run the plan and the writing, which take is on screen once there's more than one,
 * and the ways to keep it: Save (in the studio, with accounts set up) and Save as PDF.
 */
function Rework({
  nudges,
  onToggle,
  running,
  take,
  note = "Each change re-runs the plan and the writing. Qloo lookups are cached.",
  save,
}: {
  nudges: Nudge[];
  onToggle: (nudge: Nudge) => void;
  running: boolean;
  take: number;
  note?: string;
  save?: ReactNode;
}) {
  const lingo = useLingo().t;
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div
        role="group"
        aria-label="Rework this treatment"
        className="flex flex-wrap items-center gap-2.5 rounded-[28px] border border-line bg-card p-3"
      >
        {take > 1 && (
          <span className="shrink-0 rounded-full border-2 border-foreground px-3.5 py-2 font-mono text-[13px] font-semibold">
            {lingo.take(take)}
          </span>
        )}
        {/* A slang chip says what it does beside its name ("gatekeep mode", then "deeper cuts"); in unc mode the plain name
            is the whole label. */}
        {NUDGES.map((nudge) => (
          <button
            key={nudge}
            type="button"
            aria-pressed={nudges.includes(nudge)}
            aria-disabled={running}
            onClick={() => onToggle(nudge)}
            className="rounded-full border border-line bg-field px-4 py-2.5 text-[15px] hover:border-foreground aria-disabled:cursor-progress aria-disabled:opacity-50 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background"
          >
            {lingo.nudges[nudge]}
            {lingo.nudges[nudge] !== NUDGE_LABELS[nudge] && (
              <>
                <span className="sr-only">: </span>
                <span className="ml-2 text-[13px] font-normal opacity-75">{NUDGE_LABELS[nudge].toLowerCase()}</span>
              </>
            )}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {save}
          <button type="button" onClick={() => window.print()} className={outlineButton}>
            Save as PDF
          </button>
        </div>
      </div>
      <p className="px-3 text-[13px] text-faint">{note}</p>
    </div>
  );
}

export function Board({
  treatment: t,
  state,
  nudges,
  onToggleNudge,
  running,
  take,
  log,
  back,
  reworkNote,
  own = true,
  save,
  morph,
}: {
  treatment: Treatment;
  /** updating: a re-run is in flight; previous: the last re-run failed, so this is the older version. */
  state: "current" | "updating" | "previous";
  nudges: Nudge[];
  onToggleNudge: (nudge: Nudge) => void;
  running: boolean;
  /** Which take of this brief is on screen: 1, then one more per rework. */
  take: number;
  /** The run log, shown with the credits. */
  log: ReactNode;
  /** The way back, in the section bar once the cover has scrolled away: to the brief, or to all the examples. */
  back: ReactNode;
  /** Under the rework chips: what a change does here. */
  reworkNote?: string;
  /** The reader's own brief (the studio), or an example someone else briefed: "your films" or "the director's films". */
  own?: boolean;
  /** Saving to an account, beside Save as PDF: the studio's SaveControl, or a saved treatment's own controls. */
  save?: ReactNode;
  /** On an example's own page, its slug, so the cover can finish a homepage poster's match cut (morph.ts). */
  morph?: string;
}) {
  const lingo = useLingo().t;
  const whose = own ? "your" : "the director's";
  const mock = t.mock.qloo;
  const source = mock ? "the synthetic mock, not Qloo" : "Qloo";
  const templated = t.llm.filter((l) => l.producedBy.mock).map((l) => STEP_NAME[l.step].toLowerCase());
  const suggestion = suggestTitleFont(t);
  // The suggestion follows each rework until the director picks a face themselves.
  const [picked, setPicked] = useState<string | null>(null);
  const fontId = picked ?? suggestion.id;
  // No era until the director picks one; picking one picks its face as well.
  const era = useEra(t, setPicked);
  // The cover's still is the writer's pick until the director picks another; theirs holds across reworks while its film
  // is still among the references.
  const stills = t.references.flatMap((r): CoverStill[] => (r.still ? [{ id: r.entity.id, name: r.entity.name, src: r.still }] : []));
  const [stillPick, setStillPick] = useState<string | null>(null);
  const still = stills.find((s) => s.id === stillPick) ?? stills.find((s) => s.id === coverReference(t)?.entity.id);
  const stamp = dateStamp(t.createdAt);
  const cover = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);
  usePrintTitle(t.title, article);
  // Where the shoot-base map exists, it stays put beside the locations and lights the pin of the one being read.
  const pinned = (t.base?.map?.tiles.length ?? 0) > 0 && t.locations.length > 0;
  const referenceGrid = fill(t.references.length, "first");
  const beatGrid = fill(t.beats.length, "last");
  const placeGrid = fill(t.locations.length, "first");
  const overlap = withoutIdentity(t.audience.overlap);
  const tasteTags = withoutIdentity(t.audience.taste_tags);
  const [reading, setReading] = useState(0);
  const placeCards = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setReading(Number((entry.target as HTMLElement).dataset.place));
        }
      },
      // A location counts as read once it crosses the upper middle of the screen.
      { rootMargin: "-35% 0px -60% 0px" },
    );
    for (const el of placeCards.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [t]);
  return (
    <article
      ref={article}
      {...era.wear}
      aria-labelledby="treatment-title"
      aria-busy={state === "updating"}
      // Printed at four fifths of screen size: a screen's type is large print on paper, and a film or a place fits in a
      // third of a page instead of half.
      className={`flex flex-col gap-14 transition-opacity duration-300 print:opacity-100 print:[zoom:0.8] ${state === "current" ? "" : "opacity-50"}`}
    >
      {state === "previous" && (
        <p className="-mb-8 text-[15px] text-dim">
          This is the previous version. The latest change didn&apos;t finish, so nothing below reflects it.
        </p>
      )}
      {/* The cover and its tone line are the printed title page. */}
      <div className="flex flex-col gap-6 print:break-after-page">
        <Cover
          ref={cover}
          morph={morph}
          t={t}
          still={still}
          fontId={fontId}
          suggestion={suggestion}
          onPickFont={setPicked}
          stills={stills}
          onPickStill={setStillPick}
          era={era.pick}
        />
        <Giving t={t} mock={mock} whose={whose} />
        <Rework nudges={nudges} onToggle={onToggleNudge} running={running} take={take} note={reworkNote} save={save} />
      </div>

      <SectionBar t={t} fontId={fontId} take={take} running={running} cover={cover} article={article} back={back} />

      <Section id="concept" title="Concept">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] print:grid-cols-[minmax(0,1fr)_22rem]">
          <p className="max-w-[44ch] font-serif text-[clamp(1.5rem,2.3vw,1.9rem)] leading-[1.32] text-pretty">{t.concept}</p>
          {toneOf(t).length > 0 && (
            <div className={`${card} flex flex-col gap-4 p-5`}>
              <h3 className="text-[14px] font-semibold text-dim">How the tone reads</h3>
              <ul className="flex flex-col gap-4">
                {toneOf(t).map((tone) => (
                  <li key={tone.tag.id} className="flex flex-col gap-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className={`font-mono font-semibold ${evidenceTone(mock)}`}>{tagLabel(tone.tag.name)}</span>
                      <span className="text-faint">{tone.source === "overlap" ? lingo.shared(whose) : "audience taste"}</span>
                    </p>
                    <p className="font-serif text-[1.2rem] leading-snug">{tone.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section
        id="references"
        title="References"
        note={`Films this audience over-indexes on, each with its rank from ${source}. itsgiving wrote the notes.`}
      >
        {t.references.length === 0 ? (
          <p className="text-[15px] text-dim">{mock ? "The mock" : "Qloo"} returned no reference films for this brief.</p>
        ) : (
          <ul className={`grid gap-5 ${referenceGrid.grid} print:flex print:flex-col print:gap-4`}>
            {t.references.map((r, i) => (
              <li key={r.entity.id} className={`${card} flex flex-col overflow-hidden ${referenceGrid.span(i)} ${printRow}`}>
                <Still
                  src={r.still ? tmdbSize(r.still, "w780") : r.entity.image}
                  alt={r.still ? `Still from ${r.entity.name}` : `Poster for ${r.entity.name}`}
                  className={`aspect-video w-full ${referenceGrid.wide(i)} print:aspect-video ${printPicture}`}
                />
                <div className="flex flex-1 flex-col gap-3.5 p-5 print:contents">
                  <div className={printRead}>
                    <div className="flex flex-col gap-1">
                      <h3 className="type-head text-[1.7rem] leading-tight">
                        {r.entity.name}
                        {r.entity.year && (
                          <span className="ml-2 text-[1.1rem] font-normal tracking-normal text-faint">{r.entity.year}</span>
                        )}
                      </h3>
                      <QlooTags tags={r.qloo.tags} />
                    </div>
                    <p className="font-serif text-[1.15rem] leading-snug text-dim">{r.notes.why}</p>
                    <p className={prose}>
                      <span className="font-sans text-[13px] font-semibold text-faint">Borrow </span>
                      {afterLabel("Borrow", r.notes.borrow)}
                    </p>
                  </div>
                  <Why
                    label="why this film"
                    name={r.entity.name}
                    qloo={r.qloo}
                    read={[
                      { term: "Why it fits", text: r.notes.why },
                      { term: "What to borrow", text: r.notes.borrow },
                    ]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                    className={`mt-auto ${printReceipt}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Also label="Also high for this audience:" items={t.extras.references} mock={mock} />
      </Section>

      <Section id="beats" title="Beats">
        <ol className={`grid gap-4 ${beatGrid.grid}`}>
          {t.beats.map((beat, i) => (
            <li key={i} className={`${card} flex flex-col gap-2.5 p-5 ${beatGrid.span(i)}`}>
              <span aria-hidden className="type-poster text-[3.25rem] text-foreground/20">
                {i + 1}
              </span>
              <h3 className="type-head text-[1.45rem] leading-tight">{beat.title}</h3>
              <p className={prose}>{beat.description}</p>
              {beat.reference && <p className="mt-auto pt-1 text-[13px] text-faint">After {beat.reference.name}</p>}
            </li>
          ))}
        </ol>
        <div className="cut-only">
          <FilmEdge count={t.beats.length} />
        </div>
      </Section>

      <div className="cut-only">
        <Interval />
      </div>

      <Section
        id="wardrobe"
        title="Wardrobe"
        note={`Brands this audience over-indexes on, each with its rank from ${source}. itsgiving wrote the looks.`}
      >
        {t.wardrobe.length === 0 ? (
          <p className="text-[15px] text-dim">{mock ? "The mock" : "Qloo"} returned no brands for this brief.</p>
        ) : (
          <ul className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
            {t.wardrobe.map((w, i) => (
              <li
                key={w.entity.id}
                className={`${card} flex flex-col gap-3.5 p-5 ${i === t.wardrobe.length - 1 && i % 2 === 0 ? "md:col-span-2 print:col-span-2" : ""}`}
              >
                <div className="flex flex-col gap-1">
                  <h3 className="type-head text-[1.7rem] leading-tight">{w.entity.name}</h3>
                  <QlooTags tags={w.qloo.tags} />
                </div>
                <p className={prose}>{w.notes.look}</p>
                <Why
                  label="why this brand"
                  name={w.entity.name}
                  qloo={w.qloo}
                  read={[{ term: "The look", text: w.notes.look }]}
                  writtenBy={t.writtenBy}
                  mock={mock}
                  className="mt-auto"
                />
              </li>
            ))}
          </ul>
        )}
        <Also label="Also high for this audience:" items={t.extras.brands} mock={mock} />
      </Section>

      <Section
        id="locations"
        title="Locations"
        note={`Real places in ${t.brief.city} whose regulars share this audience's taste, found by ${source}. Confirm availability and filming permission with each venue.`}
      >
        <div className={pinned ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : "contents"}>
          <div className={pinned ? PINNED.wrap : ""}>
            <ShootBaseBlock
              base={t.base}
              pins={locationPins(t)}
              city={t.brief.city}
              audience={audiencePhrase(t.subjects)}
              mock={mock}
              active={pinned ? reading : undefined}
              pinned={pinned}
            />
          </div>
          {t.locations.length === 0 ? (
            <p className="text-[15px] text-dim">No locations came back for {t.brief.city}. Check the city name, or try a nearby one.</p>
          ) : (
            <ul className={`${pinned ? "flex flex-col gap-5" : `grid gap-5 ${placeGrid.grid}`} print:flex print:flex-col print:gap-4`}>
              {t.locations.map((l, i) => {
                const place = l.entity.place;
                // Mumbai's neighbourhoods come back as ward codes ("H/W Ward"), which say less than the base does.
                const hood = place?.neighborhood && !/\bward\b/i.test(place.neighborhood) ? place.neighborhood : undefined;
                const where = [place?.kind, hood, place?.price_level ? `price level ${place.price_level}\u00a0of\u00a04` : undefined]
                  .filter(Boolean)
                  .join(", ");
                const map =
                  place?.lat !== undefined && place?.lon !== undefined
                    ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`
                    : undefined;
                return (
                  <li
                    key={l.entity.id}
                    ref={(el) => {
                      placeCards.current[i] = el;
                    }}
                    data-place={i}
                    className={`${card} flex flex-col overflow-hidden ${pinned ? (reading === i ? "ring-2 ring-foreground" : "") : placeGrid.span(i)} ${printRow} print:ring-0`}
                  >
                    <div className={`relative ${printPicture}`}>
                      <Still
                        src={l.entity.image}
                        alt={`Photo of ${l.entity.name}`}
                        className={`${pinned ? "aspect-video" : `aspect-[3/2] ${placeGrid.wide(i)}`} w-full print:aspect-video`}
                      />
                      {/* Director's cut only: on a real photo of the place, a date reads as the day it was taken. */}
                      <span className="cut-only">
                        <span
                          aria-hidden
                          className="absolute right-3 bottom-2.5 rounded-md bg-black/45 px-1.5 font-mono text-[17px] font-semibold tracking-[0.08em] text-[#ff9a3c] [text-shadow:0_0_6px_rgb(255_140_40/0.8)]"
                        >
                          {stamp}
                        </span>
                      </span>
                      {t.base?.map && map && (
                        <span
                          className={`absolute top-3 left-3 grid size-8 place-items-center rounded-full text-[14px] font-bold ${
                            pinned && reading === i ? "bg-accent text-ink" : "bg-ink text-white"
                          }`}
                        >
                          <span className="sr-only">Location </span>
                          {i + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-5 print:contents">
                      <div className={printRead}>
                        <div>
                          <h3 className="type-head text-[1.6rem] leading-tight">{l.entity.name}</h3>
                          {where && <p className="mt-1 text-[14px] text-faint">{where}</p>}
                        </div>
                        {place?.ambience && (
                          <p className="text-[14px] leading-5 text-dim">
                            <span className={`font-mono text-[12px] font-semibold ${evidenceTone(mock)}`}>
                              {mock ? "Mock note" : "Qloo"}{" "}
                            </span>
                            {/* The whole note is in "Why this place". */}
                            {excerpt(place.ambience, 180)}
                          </p>
                        )}
                        <p className={prose}>{l.notes.scene}</p>
                      </div>
                      <Why
                        label="why this place"
                        name={l.entity.name}
                        qloo={l.qloo}
                        note={place?.ambience}
                        read={[{ term: "The scene", text: l.notes.scene }]}
                        writtenBy={t.writtenBy}
                        mock={mock}
                        className={`mt-auto ${printReceipt}`}
                      />
                      {/* On paper the map link (a live one in a PDF) closes the writing's column. */}
                      {map && (
                        <div className="flex flex-wrap items-center gap-2 print:col-start-2 print:row-start-4 print:px-5 print:pb-4">
                          <a
                            href={map}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full py-2 text-sm font-semibold underline decoration-edge underline-offset-4 hover:decoration-foreground"
                          >
                            Map<span className="sr-only"> of {l.entity.name} (opens in a new tab)</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Also label="More to scout:" items={t.extras.locations} mock={mock} />
      </Section>

      <Section id="camera" title="Camera and light">
        <div className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
          {(
            [
              ["Lighting", t.lighting],
              ["Shots", t.shots],
            ] as const
          ).map(([label, lines]) => (
            <div key={label} className={`${card} p-5`}>
              <h3 className="text-[14px] font-semibold text-dim">{label}</h3>
              <ul className="mt-1 flex flex-col divide-y divide-line">
                {lines.map((line, i) => (
                  <li key={i} className={`py-3 ${prose}`}>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="palette" title="Palette" note={<span className="print:hidden">Tap a colour to copy its hex code.</span>}>
        <PaletteSwatches palette={t.palette} />
      </Section>

      <Section
        id="audience"
        title="Audience"
        follows
        note={
          mock
            ? "Synthetic fixtures standing in for Qloo's taste graph: real names, invented affinities."
            : "What Qloo's taste graph says about this audience: aggregate affinities, never facts about any one person."
        }
      >
        <div className={`${card} p-6`}>
          <dl className="grid gap-x-10 gap-y-6 md:grid-cols-[14rem_minmax(0,1fr)] print:grid-cols-[14rem_minmax(0,1fr)]">
            {overlap.length > 0 && (
              <>
                <dt className="text-[15px] font-semibold">Shared by {whose} films and the audience</dt>
                <dd>
                  <EvidenceChips tags={overlap} mock={mock} shared />
                </dd>
              </>
            )}
            <dt className="text-[15px] font-semibold">Themes and genres the audience over-indexes on</dt>
            <dd>
              {tasteTags.length > 0 ? (
                <EvidenceChips tags={tasteTags} mock={mock} />
              ) : (
                <p className="text-[15px] text-dim">No taste tags came back.</p>
              )}
            </dd>
            {t.audience.leans.length > 0 && (
              <>
                <dt className="text-[15px] font-semibold">Age and gender</dt>
                <dd className={`font-mono text-[13px] leading-6 ${evidenceTone(mock)}`}>{t.audience.leans.join("; ")}</dd>
              </>
            )}
          </dl>
        </div>
      </Section>

      <Section id="credits" title="Credits" follows>
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <div className={`${card} p-6`}>
            <dl className="grid gap-x-8 gap-y-3 text-[15px] leading-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-faint">Built</dt>
              {/* A fixed locale and UTC, so a board rendered on the server (a featured page) reads the same everywhere. */}
              <dd>{new Date(t.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</dd>
              <dt className="text-faint">Data</dt>
              <dd>
                {t.qloo.calls} {mock ? "mock " : ""}Qloo requests
              </dd>
              {t.llm.map((l) => (
                <Fragment key={l.step}>
                  <dt className="text-faint">{STEP_NAME[l.step]}</dt>
                  <dd>{modelName(l.producedBy)}</dd>
                </Fragment>
              ))}
              {t.director.length > 0 && (
                <>
                  <dt className="text-faint">{own ? "Your taste" : "Director's taste"}</dt>
                  <dd>
                    {listWithYears(t.director.slice(0, 8))}
                    {t.director.length > 8 ? ` and ${t.director.length - 8} more` : ""}
                  </dd>
                </>
              )}
              {t.references.some((r) => r.still) && (
                <>
                  <dt className="text-faint">Film stills</dt>
                  <dd>TMDB</dd>
                </>
              )}
              <dt className="text-faint">Creative direction</dt>
              <dd className="font-serif text-[1.15rem] leading-snug">{t.direction}</dd>
            </dl>
            {t.notes.length > 0 && (
              <ul className="mt-6 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-6 text-dim marker:text-edge">
                {t.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            {t.mock.qloo && (
              <p className="mt-4 text-[14px] text-tape">
                Mock data: the names are real, but every score, tag, photo and ranking here is synthetic, not Qloo&apos;s.
              </p>
            )}
            {templated.length > 0 && (
              <p className="mt-2 text-[14px] text-tape">
                Mock LLM: a deterministic template did the {templated.join(" and ")} {templated.length === 1 ? "step" : "steps"}, not a
                language model.
              </p>
            )}
          </div>
          <div className={`${card} p-6 print:hidden`}>{log}</div>
        </div>
      </Section>
    </article>
  );
}
