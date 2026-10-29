"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NUDGES,
  NUDGE_LABELS,
  aboveBudget,
  audiencePhrase,
  budgetPhrase,
  coverReference,
  joinNames,
  openingLine,
  priceLine,
  siteName,
  tagLabel,
  tmdbSize,
  withYear,
  withoutIdentity,
  type Nudge,
} from "@/lib/agent/options";
import type { Character, LlmStep, Treatment } from "@/lib/agent/types";
import type { KnownRole } from "@/lib/tmdb";
import type { CompactEntity, CompactTag } from "@/lib/qloo/normalize";
import { PINNED, ShootBaseBlock, locationPins } from "./base-map";
import { useEra } from "./era-layer";
import { useLingo } from "./lingo";
import { QlooNote, QlooTags, Still, Tape, Why, modelName } from "./parts";
import { type CoverStill } from "./title-card";
import { suggestTitleFont } from "./title-fonts";
import { evidenceTone, outlineButton, paperEvidence, rankMark } from "./ui";
import { afterLabel, listWithYears } from "@/lib/text";
import { Cover, PaletteSwatches } from "./cover";
import { SectionBar } from "./section-bar";
import { FilmEdge, Interval, dateStamp } from "./board-cut";
import { printPicture, printRead, printReceipt, printRow, usePrintTitle } from "./board-print";

const STEP_NAME: Record<LlmStep, string> = { plan: "Plan", replan: "Re-plan", write: "Writing" };

/** itsgiving's own writing is set in the serif; the tool, labels and Qloo's evidence stay in the interface faces. */
const prose = "font-serif text-prose leading-[1.38]";
/** A card is never cut across two printed pages. */
const card = "rounded-[26px] border border-line bg-card print:break-inside-avoid";
/** A place's map, phone and website, at the foot of its card. */
const placeLink = "py-2 text-small leading-5 font-semibold underline decoration-edge underline-offset-4 hover:decoration-foreground";

/** A character's sketch, after who they are, in reading order. */
const SKETCH: [string, "wants" | "hides" | "presence" | "look" | "arc"][] = [
  ["Wants", "wants"],
  ["Hides", "hides"],
  ["Presence", "presence"],
  ["Look", "look"],
  ["Arc", "arc"],
];

/** "Calum in Aftersun (2022) and Lucius in Gladiator II (2024)". */
const knownAs = (roles: KnownRole[]) => joinNames(roles.map((role) => `${role.character} in ${withYear(role.title, role.year)}`));

/** What TMDB gave this board, for its credits: stills, the characters its people draw on, and actors' roles and photos. */
const tmdbGave = (t: Treatment) =>
  [
    t.references.some((r) => r.still) && "film stills",
    t.characters?.some((c) => c.from) && "characters",
    t.characters?.some((c) => c.face?.known.length) && "actors' roles",
    t.characters?.some((c) => c.face?.photo) && "actors' photos",
  ].filter((part): part is string => Boolean(part));

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The names of the people in a beat (1-based), as the writer placed them. */
const peopleIn = (characters: Character[] | undefined, beat: number) =>
  (characters ?? []).filter((c) => c.beats.includes(beat)).map((c) => c.name);

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
        <h2 id={id} className="type-head scroll-mt-24 text-section leading-none">
          {title}
        </h2>
        {note && <p className="max-w-[60ch] text-ui leading-6 text-faint">{note}</p>}
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
          className={`rounded-full px-3 py-1.5 font-mono text-caption ${
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
    <p className="text-ui leading-6 text-dim">
      {label} <span className={`font-mono text-caption ${evidenceTone(mock)}`}>{listWithYears(items)}</span>
    </p>
  );
}

/**
 * The story's people, one to a row: who they are and their sketch in the serif (itsgiving's writing), the character in a
 * title this audience loves that they're drawn from (TMDB's credits, with Qloo's archetypes for the title), and the actor
 * whose presence fits the part, with Qloo's receipt for them and the parts TMDB says they're known for.
 */
function Characters({ t, mock, source }: { t: Treatment; mock: boolean; source: string }) {
  const characters = t.characters ?? [];
  const drawn = characters.some((c) => c.from);
  const faced = characters.some((c) => c.face);
  const note = [
    "itsgiving wrote these characters.",
    drawn && "Each draws on a character in a title this audience loves, as TMDB credits it.",
    faced && `The actors are ones this audience over-indexes on, each with its rank from ${source}: references for the part, not offers.`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Section id="characters" title="Characters" note={note}>
      {characters.length > 0 ? (
        <ul className="flex flex-col gap-5 print:gap-4">
          {characters.map((c) => (
            <li key={c.name} className={`${card} flex flex-col overflow-hidden sm:flex-row`}>
              {c.face && (
                <div className="flex shrink-0 flex-col border-line sm:w-48 sm:border-r">
                  <Still
                    src={c.face.entity.image ?? c.face.photo}
                    alt={`Photo of ${c.face.entity.name}`}
                    className="aspect-[3/2] w-full object-[50%_22%] sm:aspect-[4/5] sm:object-center"
                  />
                  <div className="flex flex-col gap-1 p-4">
                    <p className="text-ui leading-5 font-semibold">{c.face.entity.name}</p>
                    {c.face.known.length > 0 && (
                      <p className="text-caption leading-5 text-faint">Known as {knownAs(c.face.known)}, per TMDB</p>
                    )}
                    {c.face.photo && <p className="text-caption leading-5 text-faint">Photo: TMDB</p>}
                  </div>
                </div>
              )}
              <div className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <h3 className="type-head text-title leading-tight">{c.name}</h3>
                  <p className={`${prose} max-w-[64ch]`}>{c.who}</p>
                </div>
                <dl className="grid gap-x-8 gap-y-3 xl:grid-cols-2 print:grid-cols-2">
                  {SKETCH.map(([term, key]) => (
                    <div key={key} className={`flex flex-col gap-0.5 ${key === "arc" ? "xl:col-span-2 print:col-span-2" : ""}`}>
                      <dt className="text-caption font-semibold text-faint">{term}</dt>
                      <dd className="max-w-[64ch] font-serif text-lead leading-snug">
                        {c[key]}
                        {key === "arc" && c.beats.length > 0 && (
                          <>
                            {" "}
                            <span className="ml-1 font-sans text-caption whitespace-nowrap text-faint">
                              {c.beats.length > 1 ? "Beats" : "Beat"} {joinNames(c.beats.map(String))}
                            </span>
                          </>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {c.from && (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <p className="max-w-[64ch] text-ui leading-6">
                      <span className="font-semibold">Drawn from {c.from.character}</span> ({c.from.actor}) in{" "}
                      {withYear(c.from.title.name, c.from.title.year)}
                      {c.from.take && <span className="font-serif text-lead leading-snug">: {c.from.take}</span>}
                    </p>
                    {c.from.archetypes.length > 0 && (
                      <p className="text-caption leading-5 text-faint">
                        Qloo&apos;s archetypes for the {c.from.title.kind === "tv_show" ? "series" : "film"}:{" "}
                        <span className={`font-mono text-label ${evidenceTone(mock)}`}>{c.from.archetypes.join(" / ")}</span>
                      </p>
                    )}
                  </div>
                )}
                {c.face && (
                  <Why
                    label="why this face"
                    name={c.face.entity.name}
                    qloo={c.face.qloo}
                    of="actors"
                    read={[{ term: "The part", text: c.presence }]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                    className="mt-auto max-w-sm"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-dim">The writer sketched no characters for this treatment.</p>
      )}
      <Also
        label={faced ? "Also high for this audience:" : "Actors this audience over-indexes on:"}
        items={t.extras.people ?? []}
        mock={mock}
      />
    </Section>
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
        <h2 id="giving-title" className="mr-2 font-serif text-display-sm leading-none font-normal italic">
          {lingo.giving}
        </h2>
        {tone.map((x) => (
          <span
            key={x.tag.id}
            className={
              mark && x.source === "overlap"
                ? "rounded-full bg-accent px-4 py-2.5 text-body font-bold text-ink"
                : "rounded-full border border-line bg-card px-4 py-2.5 text-body"
            }
          >
            {tagLabel(x.tag.name)}
            {mark && x.source === "overlap" && <span className="sr-only"> ({lingo.shared(whose)})</span>}
          </span>
        ))}
        {mock && <Tape>Mock data</Tape>}
      </div>
      <p className="text-ui text-faint">
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
          <span className="shrink-0 rounded-full border-2 border-foreground px-3.5 py-2 font-mono text-caption font-semibold">
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
            className="rounded-full border border-line bg-field px-4 py-2.5 text-ui hover:border-foreground aria-disabled:cursor-progress aria-disabled:opacity-50 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background"
          >
            {lingo.nudges[nudge]}
            {lingo.nudges[nudge] !== NUDGE_LABELS[nudge] && (
              <>
                <span className="sr-only">: </span>
                <span className="ml-2 text-caption font-normal opacity-75">{NUDGE_LABELS[nudge].toLowerCase()}</span>
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
      <p className="px-3 text-caption text-faint">{note}</p>
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
        <p className="-mb-8 text-ui text-dim">
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
          <p className="max-w-[44ch] font-serif text-logline leading-[1.32] text-pretty">{t.concept}</p>
          {toneOf(t).length > 0 && (
            <div className={`${card} flex flex-col gap-4 p-5`}>
              <h3 className="text-small font-semibold text-dim">How the tone reads</h3>
              <ul className="flex flex-col gap-4">
                {toneOf(t).map((tone) => (
                  <li key={tone.tag.id} className="flex flex-col gap-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-caption">
                      <span className={`font-mono font-semibold ${evidenceTone(mock)}`}>{tagLabel(tone.tag.name)}</span>
                      <span className="text-faint">{tone.source === "overlap" ? lingo.shared(whose) : "audience taste"}</span>
                    </p>
                    <p className="font-serif text-prose leading-snug">{tone.note}</p>
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
        note={`${t.references.some((r) => r.entity.kind === "tv_show") ? "Films and series" : "Films"} this audience over-indexes on, each with its rank from ${source}. itsgiving wrote the notes.`}
      >
        {t.references.length === 0 ? (
          <p className="text-ui text-dim">{mock ? "The mock" : "Qloo"} returned no reference films for this brief.</p>
        ) : (
          <ul className={`grid gap-5 ${referenceGrid.grid} print:flex print:flex-col print:gap-4`}>
            {t.references.map((r, i) => {
              const series = r.entity.kind === "tv_show";
              const year = series ? ["Series", r.entity.year].filter(Boolean).join(", ") : r.entity.year;
              return (
                <li key={r.entity.id} className={`${card} flex flex-col overflow-hidden ${referenceGrid.span(i)} ${printRow}`}>
                  <Still
                    src={r.still ? tmdbSize(r.still, "w780") : r.entity.image}
                    alt={r.still ? `Still from ${r.entity.name}` : `Poster for ${r.entity.name}`}
                    className={`aspect-video w-full ${referenceGrid.wide(i)} print:aspect-video ${printPicture}`}
                  />
                  <div className="flex flex-1 flex-col gap-3.5 p-5 print:contents">
                    <div className={printRead}>
                      <div className="flex flex-col gap-1">
                        <h3 className="type-head text-title leading-tight">
                          {r.entity.name}
                          {year && <span className="ml-2 text-lead font-normal tracking-normal text-faint">{year}</span>}
                        </h3>
                        <QlooTags tags={r.qloo.tags} />
                      </div>
                      <p className="font-serif text-lead leading-snug text-dim">{r.notes.why}</p>
                      <p className={prose}>
                        <span className="font-sans text-caption font-semibold text-faint">Borrow </span>
                        {afterLabel("Borrow", r.notes.borrow)}
                      </p>
                    </div>
                    <Why
                      label={series ? "why this series" : "why this film"}
                      name={r.entity.name}
                      qloo={r.qloo}
                      of={series ? "series" : "films"}
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
              );
            })}
          </ul>
        )}
        <Also label="Also high for this audience:" items={t.extras.references} mock={mock} />
      </Section>

      <Section id="beats" title="Beats">
        <ol className={`grid gap-4 ${beatGrid.grid}`}>
          {t.beats.map((beat, i) => (
            <li key={i} className={`${card} flex flex-col gap-2.5 p-5 ${beatGrid.span(i)}`}>
              <span aria-hidden className="type-poster text-display-sm text-foreground/20">
                {i + 1}
              </span>
              <h3 className="type-head text-subhead leading-tight">{beat.title}</h3>
              <p className={prose}>{beat.description}</p>
              {(beat.reference || peopleIn(t.characters, i + 1).length > 0) && (
                <div className="mt-auto flex flex-col pt-1 text-caption text-faint">
                  {peopleIn(t.characters, i + 1).length > 0 && <p>With {joinNames(peopleIn(t.characters, i + 1))}</p>}
                  {beat.reference && <p>After {beat.reference.name}</p>}
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="cut-only">
          <FilmEdge count={t.beats.length} />
        </div>
      </Section>

      {/* Boards built from 2026-10-29 sketch the story's people; those from 2026-10-28 have casting; older ones neither. */}
      {t.characters ? (
        <Characters t={t} mock={mock} source={source} />
      ) : (
        t.casting && (
          <Section
            id="casting"
            title="Casting"
            note={`Actors this audience over-indexes on, each with its rank from ${source}: references for the presence a role needs, not offers. itsgiving wrote the roles.`}
          >
            {t.casting.length > 0 ? (
              // On paper too, each face is a small portrait beside its role, one under another: a page holds three of them
              // and the line of other actors after them.
              <ul className="grid gap-5 lg:grid-cols-2 print:flex print:flex-col print:gap-4">
                {t.casting.map((c, i, all) => (
                  <li
                    key={c.entity.id}
                    className={`${card} flex flex-col overflow-hidden sm:flex-row ${i === all.length - 1 && i % 2 === 0 ? "lg:col-span-2" : ""}`}
                  >
                    <Still
                      src={c.entity.image}
                      alt={`Photo of ${c.entity.name}`}
                      className="aspect-[3/2] w-full shrink-0 object-[50%_22%] sm:aspect-[4/5] sm:w-40 sm:object-center"
                    />
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <h3 className="type-head text-title leading-tight">{c.entity.name}</h3>
                          <QlooTags tags={c.qloo.tags} />
                        </div>
                        <p className={`${prose} max-w-[64ch]`}>{c.notes.role}</p>
                      </div>
                      <Why
                        label="why this face"
                        name={c.entity.name}
                        qloo={c.qloo}
                        of="actors"
                        read={[{ term: "The role", text: c.notes.role }]}
                        writtenBy={t.writtenBy}
                        mock={mock}
                        className="mt-auto"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              (t.extras.people?.length ?? 0) === 0 && (
                <p className="text-ui text-dim">{mock ? "The mock" : "Qloo"} returned no actors for this audience.</p>
              )
            )}
            {/* With no roles written, Qloo's actors are still evidence of the faces this audience knows. */}
            <Also
              label={t.casting.length > 0 ? "Also high for this audience:" : "Actors this audience over-indexes on:"}
              items={t.extras.people ?? []}
              mock={mock}
            />
          </Section>
        )
      )}

      <div className="cut-only">
        <Interval />
      </div>

      <Section
        id="wardrobe"
        title="Wardrobe"
        note={`Brands this audience over-indexes on, each with its rank from ${source}. itsgiving wrote the looks.`}
      >
        {t.wardrobe.length === 0 ? (
          <p className="text-ui text-dim">{mock ? "The mock" : "Qloo"} returned no brands for this brief.</p>
        ) : (
          <ul className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
            {t.wardrobe.map((w, i) => {
              const price = priceLine(w.entity.brand?.price);
              const reference = aboveBudget(w.entity, t.brief.budget);
              return (
                <li
                  key={w.entity.id}
                  className={`${card} flex flex-col gap-3.5 p-5 ${i === t.wardrobe.length - 1 && i % 2 === 0 ? "md:col-span-2 print:col-span-2" : ""}`}
                >
                  <div className="flex flex-col gap-1">
                    <h3 className="type-head text-title leading-tight">{w.entity.name}</h3>
                    <QlooTags tags={w.qloo.tags} />
                    {price && (
                      <p className="text-small text-faint">
                        {price}
                        {reference && `, above ${budgetPhrase(t.brief.budget)}: rent it or match it`}
                      </p>
                    )}
                  </div>
                  <QlooNote text={w.entity.brand?.style} mock={mock} />
                  <p className={`${prose} max-w-[64ch]`}>{w.notes.look}</p>
                  <Why
                    label="why this brand"
                    name={w.entity.name}
                    qloo={w.qloo}
                    facts={[
                      { term: "Style", text: w.entity.brand?.style },
                      { term: "Prices", text: price },
                    ]}
                    read={[{ term: "The look", text: w.notes.look }]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                    className="mt-auto"
                  />
                </li>
              );
            })}
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
            <p className="text-ui text-dim">No locations came back for {t.brief.city}. Check the city name, or try a nearby one.</p>
          ) : (
            <ul className={`${pinned ? "flex flex-col gap-5" : `grid gap-5 ${placeGrid.grid}`} print:flex print:flex-col print:gap-4`}>
              {t.locations.map((l, i) => {
                const place = l.entity.place;
                // Mumbai's neighbourhoods come back as ward codes ("H/W Ward"), which say less than the base does.
                const hood = place?.neighborhood && !/\bward\b/i.test(place.neighborhood) ? place.neighborhood : undefined;
                const where = [place?.kind, hood, place?.price_level ? `price level ${place.price_level}\u00a0of\u00a04` : undefined]
                  .filter(Boolean)
                  .join(", ");
                const hours = openingLine(place?.hours);
                const suits = [place?.fits?.length ? `Suits ${place.fits.join(", ").toLowerCase()}` : undefined, ...(place?.views ?? [])]
                  .filter(Boolean)
                  .join("; ");
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
                          className="absolute right-3 bottom-2.5 rounded-md bg-black/45 px-1.5 font-mono text-body font-semibold tracking-[0.08em] text-[#ff9a3c] [text-shadow:0_0_6px_rgb(255_140_40/0.8)]"
                        >
                          {stamp}
                        </span>
                      </span>
                      {t.base?.map && map && (
                        <span
                          className={`absolute top-3 left-3 grid size-8 place-items-center rounded-full text-small font-bold ${
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
                          <h3 className="type-head text-title leading-tight">{l.entity.name}</h3>
                          {where && <p className="mt-1 text-small text-faint">{where}</p>}
                          {hours && <p className="text-small text-faint">Open {hours}</p>}
                          {suits && <p className="text-small text-faint">{suits}</p>}
                        </div>
                        <QlooNote text={place?.ambience} mock={mock} />
                        <p className={prose}>{l.notes.scene}</p>
                      </div>
                      <Why
                        label="why this place"
                        name={l.entity.name}
                        qloo={l.qloo}
                        facts={[
                          { term: "Atmosphere", text: place?.ambience },
                          { term: "The space", text: place?.setting },
                          { term: "Open", text: hours },
                        ]}
                        read={[{ term: "The scene", text: l.notes.scene }]}
                        writtenBy={t.writtenBy}
                        mock={mock}
                        className={`mt-auto ${printReceipt}`}
                      />
                      {/* The map and the venue's own number and site, to ask about filming there. On paper they close the
                          writing's column (live links in a PDF). */}
                      {(map || place?.phone || place?.website) && (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 print:col-start-2 print:row-start-4 print:px-5 print:pb-4">
                          {map && (
                            <a href={map} target="_blank" rel="noreferrer" className={placeLink}>
                              Map<span className="sr-only"> of {l.entity.name} (opens in a new tab)</span>
                            </a>
                          )}
                          {place?.phone && (
                            <a href={`tel:${place.phone.replace(/[^\d+]/g, "")}`} className={placeLink}>
                              <span className="sr-only">Call {l.entity.name}: </span>
                              {place.phone}
                            </a>
                          )}
                          {place?.website && (
                            <a href={place.website} target="_blank" rel="noreferrer" className={placeLink}>
                              {siteName(place.website)}
                              <span className="sr-only">: the website of {l.entity.name} (opens in a new tab)</span>
                            </a>
                          )}
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
              <h3 className="text-small font-semibold text-dim">{label}</h3>
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

      {/* A short film's music; a music video's song is given, and boards built before 2026-10-28 have none. */}
      {t.music && (
        <Section
          id="music"
          title="Music"
          note={`Artists this audience over-indexes on, each with its rank from ${source}, for needle drops and the score's direction. A song named here is from ${mock ? "the mock's" : "Qloo's"} list of the artist's notable songs: clear any track before you use it. itsgiving wrote the notes.`}
        >
          {t.music.length > 0 ? (
            <ul className="grid gap-5 md:grid-cols-2 print:grid-cols-2">
              {t.music.map((m, i, all) => (
                <li
                  key={m.entity.id}
                  className={`${card} flex flex-col gap-3.5 p-5 ${i === all.length - 1 && i % 2 === 0 ? "md:col-span-2 print:col-span-2" : ""}`}
                >
                  <div className="flex flex-col gap-1">
                    <h3 className="type-head text-title leading-tight">{m.entity.name}</h3>
                    <QlooTags tags={m.entity.artist?.genres ?? m.qloo.tags} />
                    {m.notes.song && <p className="text-small text-faint">Song: {m.notes.song}</p>}
                  </div>
                  <p className={`${prose} max-w-[64ch]`}>{m.notes.use}</p>
                  <Why
                    label="why this artist"
                    name={m.entity.name}
                    qloo={m.qloo}
                    of="artists"
                    facts={[
                      { term: "Songs", text: m.entity.artist?.songs?.join(", ") },
                      { term: "Lyrics about", text: m.entity.artist?.themes?.join(", ") },
                    ]}
                    read={[{ term: "How it's used", text: m.notes.use }]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                    className="mt-auto"
                  />
                </li>
              ))}
            </ul>
          ) : (
            (t.extras.artists?.length ?? 0) === 0 && (
              <p className="text-ui text-dim">{mock ? "The mock" : "Qloo"} returned no artists for this audience.</p>
            )
          )}
          <Also
            label={t.music.length > 0 ? "Also high for this audience:" : "Artists this audience over-indexes on:"}
            items={t.extras.artists ?? []}
            mock={mock}
          />
        </Section>
      )}

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
                <dt className="text-ui font-semibold">Shared by {whose} films and the audience</dt>
                <dd>
                  <EvidenceChips tags={overlap} mock={mock} shared />
                </dd>
              </>
            )}
            {t.directorFit && t.directorFit.length > 0 && (
              <>
                <dt className="text-ui font-semibold">How the audience ranks {whose} films</dt>
                <dd>
                  <ol className="flex max-w-[34rem] flex-col gap-1.5">
                    {t.directorFit.map(({ entity, qloo }) => (
                      <li key={entity.id} className="flex items-baseline gap-3 text-ui leading-6">
                        <span
                          className={`min-w-6 rounded-md px-1.5 text-center font-mono text-label font-semibold tabular-nums ${
                            qloo.rank === 1 ? rankMark(mock) : "text-faint"
                          }`}
                        >
                          {qloo.rank}
                        </span>
                        <span>
                          {withYear(entity.name, entity.year)}
                          {entity.kind === "tv_show" && <span className="text-faint"> (series)</span>}
                        </span>
                        {typeof qloo.affinity === "number" && (
                          <span className={`ml-auto font-mono text-caption tabular-nums ${evidenceTone(mock)}`}>
                            affinity {qloo.affinity.toFixed(3)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </dd>
              </>
            )}
            <dt className="text-ui font-semibold">Themes and genres the audience over-indexes on</dt>
            <dd>
              {tasteTags.length > 0 ? (
                <EvidenceChips tags={tasteTags} mock={mock} />
              ) : (
                <p className="text-ui text-dim">No taste tags came back.</p>
              )}
            </dd>
            {!t.music && (t.extras.artists?.length ?? 0) > 0 && (
              <>
                <dt className="text-ui font-semibold">Music they play</dt>
                <dd className={`font-mono text-caption leading-6 ${evidenceTone(mock)}`}>
                  {t.extras
                    .artists!.slice(0, 6)
                    .map((a) => a.name)
                    .join(", ")}
                </dd>
              </>
            )}
            {t.audience.leans.length > 0 && (
              <>
                <dt className="text-ui font-semibold">Age and gender</dt>
                <dd className={`font-mono text-caption leading-6 ${evidenceTone(mock)}`}>{t.audience.leans.join("; ")}</dd>
              </>
            )}
          </dl>
        </div>
      </Section>

      <Section id="credits" title="Credits" follows>
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <div className={`${card} p-6`}>
            <dl className="grid gap-x-8 gap-y-3 text-ui leading-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
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
              {tmdbGave(t).length > 0 && (
                <>
                  <dt className="text-faint">{capitalized(joinNames(tmdbGave(t)))}</dt>
                  <dd>TMDB</dd>
                </>
              )}
              <dt className="text-faint">Creative direction</dt>
              <dd className="font-serif text-lead leading-snug">{t.direction}</dd>
            </dl>
            {t.notes.length > 0 && (
              <ul className="mt-6 flex list-disc flex-col gap-1 pl-5 text-small leading-6 text-dim marker:text-edge">
                {t.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            {t.mock.qloo && (
              <p className="mt-4 text-small text-tape">
                Mock data: the names are real, but every score, tag, photo and ranking here is synthetic, not Qloo&apos;s.
              </p>
            )}
            {templated.length > 0 && (
              <p className="mt-2 text-small text-tape">
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
