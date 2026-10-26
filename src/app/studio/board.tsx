"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { BUDGETS, FORMATS, NUDGES, NUDGE_LABELS, audiencePhrase, subjectPhrase, type Nudge } from "@/lib/agent/options";
import type { LlmStep, Treatment } from "@/lib/agent/types";
import type { CompactEntity, CompactTag } from "@/lib/qloo/normalize";
import { ShootBaseBlock, locationPins } from "./base-map";
import { darkOf } from "./landing";
import { useLingo } from "./lingo";
import { QlooTags, Receipt, Still, Tape, Why, modelName } from "./parts";
import { TitleCardPicker } from "./title-card";
import { suggestTitleFont, titleFont, titleStyle } from "./title-fonts";

const STEP_NAME: Record<LlmStep, string> = { plan: "Plan", replan: "Re-plan", write: "Writing" };

/** The treatment's sections, in reading order, for the section bar under the cover. */
const SECTIONS = [
  ["concept", "Concept"],
  ["references", "References"],
  ["beats", "Beats"],
  ["wardrobe", "Wardrobe"],
  ["locations", "Locations"],
  ["camera", "Camera and light"],
  ["palette", "Palette"],
  ["audience", "Audience"],
  ["credits", "Credits"],
] as const;

/** itsgiving's own writing is set in the serif; the tool, labels and Qloo's evidence stay in the interface faces. */
const prose = "font-serif text-[1.25rem] leading-[1.38]";
const card = "rounded-[26px] border border-line bg-card";

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex scroll-mt-24 flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3 id={id} className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          {title}
        </h3>
        {note && <p className="max-w-[60ch] text-[15px] leading-6 text-faint">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function names(entities: CompactEntity[]): string {
  return entities.map((e) => `${e.name}${e.year ? ` (${e.year})` : ""}`).join(", ");
}

/** Qloo evidence set in prose: mono, tungsten for Qloo, tape pink for the synthetic mock standing in for it. */
const evidenceTone = (mock: boolean) => (mock ? "text-tape" : "text-tungsten");

function EvidenceChips({ tags, mock, shared }: { tags: CompactTag[]; mock: boolean; shared?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className={`rounded-full px-3 py-1.5 font-mono text-[13px] ${
            shared
              ? "bg-accent font-semibold text-[#121211]"
              : `border border-dashed border-slip-edge bg-slip ${mock ? "text-[#a3195b]" : "text-[#855000]"}`
          }`}
        >
          {tag.name}
        </li>
      ))}
    </ul>
  );
}

function Also({ label, items, mock }: { label: string; items: CompactEntity[]; mock: boolean }) {
  if (items.length === 0) return null;
  return (
    <p className="text-[15px] leading-6 text-dim">
      {label} <span className={`font-mono text-[13px] ${evidenceTone(mock)}`}>{names(items)}</span>
    </p>
  );
}

function Cover({
  ref,
  t,
  fontId,
  suggestion,
  onPickFont,
}: {
  ref?: Ref<HTMLElement>;
  t: Treatment;
  fontId: string;
  suggestion: { id: string; why: string };
  onPickFont: (id: string) => void;
}) {
  // Mock placeholders carry their own "not Qloo data" text, which would fight the title.
  const still = t.references.find((r) => r.entity.image && !r.entity.image.startsWith("/mock/"))?.entity.image;
  const subject = subjectPhrase(
    t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
    t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
  );
  return (
    <header
      ref={ref}
      key={`${t.id}-${t.createdAt}`}
      className="letterbox-open surface-dark grain relative isolate flex min-h-[32rem] flex-col justify-between gap-10 overflow-hidden rounded-[2rem] p-6 sm:min-h-[36rem] sm:p-10"
      style={{ background: darkOf(t.palette.map((c) => c.hex)) }}
    >
      <div aria-hidden className="absolute inset-0 -z-10">
        {still && <Still src={still} alt="" className="absolute inset-0 size-full opacity-50" />}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgb(10_9_8/0.9)_0%,rgb(10_9_8/0.35)_55%,rgb(10_9_8/0.6)_100%)]" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-edge px-3.5 py-2 text-[14px] text-dim">
            {FORMATS[t.brief.format]} {subject}, {t.brief.city}, {BUDGETS[t.brief.budget].label.toLowerCase()} budget
          </span>
          {t.mock.qloo && <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>}
        </div>
        <TitleCardPicker title={t.title} fontId={fontId} suggestion={suggestion} onPick={onPickFont} />
      </div>
      <div className="flex flex-col gap-6">
        <h2 id="treatment-title" tabIndex={-1} className="max-w-[16ch] text-balance" style={titleStyle(titleFont(fontId))}>
          {t.title}
        </h2>
        <p className="max-w-[40ch] font-serif text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.2] text-pretty italic">{t.logline}</p>
        <ul aria-label="Palette" className="flex flex-wrap gap-2">
          {t.palette.map((c) => (
            <li key={c.hex} className="flex items-center gap-2 rounded-full bg-black/40 py-1.5 pr-3.5 pl-1.5 text-[13px]">
              <span aria-hidden className="size-[22px] rounded-full ring-1 ring-white/25" style={{ background: c.hex }} />
              {c.name}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

/** "it's giving": the tone tags Qloo found, with the ones shared with the director's taste highlighted. */
function Giving({ t, mock }: { t: Treatment; mock: boolean }) {
  const lingo = useLingo().t;
  if (t.tone.length === 0) return null;
  const shared = t.tone.some((tone) => tone.source === "overlap");
  return (
    <section aria-labelledby="giving-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 id="giving-title" className="mr-2 font-serif text-[clamp(2.5rem,4.5vw,3.25rem)] leading-none font-normal italic">
          {lingo.giving}
        </h3>
        {t.tone.map((tone) =>
          tone.source === "overlap" ? (
            <span
              key={tone.tag.id}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-[17px] font-bold text-[#121211]"
            >
              {tone.tag.name}
              <span className="text-[13px] font-normal">{lingo.shared}</span>
            </span>
          ) : (
            <span key={tone.tag.id} className="rounded-full border border-line bg-card px-4 py-2.5 text-[17px]">
              {tone.tag.name}
            </span>
          ),
        )}
        {mock && <Tape>Mock data</Tape>}
      </div>
      <p className="text-[15px] text-faint">
        Tone tags from {mock ? "the synthetic mock, not Qloo" : "Qloo"}: what this audience over-indexes on.
        {shared ? " The highlighted one is shared with the films you love." : ""}
      </p>
    </section>
  );
}

/** The rework bar: the nudges that re-run the plan and the writing, and which take is on screen once there's more than one. */
function Rework({
  nudges,
  onToggle,
  running,
  take,
  note = "Each change re-runs the plan and the writing. Qloo lookups are cached.",
}: {
  nudges: Nudge[];
  onToggle: (nudge: Nudge) => void;
  running: boolean;
  take: number;
  note?: string;
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
            {lingo.nudges[nudge] !== NUDGE_LABELS[nudge] && <span className="sr-only">: {NUDGE_LABELS[nudge]}</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-full border border-foreground px-4 py-2.5 text-[15px] font-semibold hover:bg-foreground hover:text-background"
        >
          Save as PDF
        </button>
      </div>
      <p className="px-3 text-[13px] text-faint">{note}</p>
    </div>
  );
}

/**
 * One sticky bar under the cover: the sections to jump to, the one being read lit, and a thin line that fills as the
 * reader goes down the board. Once the cover has scrolled away, the way back and the title join it on the left (inert
 * until then, so the keyboard never lands on them unseen). Its background runs to the window's edges.
 */
function SectionBar({
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
  const [stuck, setStuck] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const line = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setStuck((cover.current?.getBoundingClientRect().bottom ?? 1) < 0);
      let reading: string | null = null;
      for (const [id] of SECTIONS) {
        const heading = document.getElementById(id);
        if (heading && heading.getBoundingClientRect().top <= 120) reading = id;
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
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [cover, article]);

  return (
    <div className="sticky top-0 z-30 bg-background shadow-[0_0_0_100vmax_var(--background)] [clip-path:inset(0_-100vmax)] print:hidden">
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
            <span className="hidden shrink-0 rounded-md border border-edge px-2 py-0.5 font-mono text-[12px] text-dim sm:inline">
              {lingo.take(take)}
            </span>
          )}
          {running && (
            <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
              <span aria-hidden className="size-2 rounded-full bg-foreground motion-safe:animate-pulse" />
              <span className="hidden sm:inline">{lingo.cookingAgain}</span>
            </span>
          )}
        </div>
        <nav aria-label="Treatment sections" className="quiet-scroll -mx-1 ml-auto flex min-w-0 gap-1 overflow-x-auto px-1">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={current === id ? "location" : undefined}
              className="shrink-0 rounded-full px-3 py-1.5 text-[14px] font-semibold whitespace-nowrap text-dim hover:text-foreground aria-[current=location]:bg-foreground aria-[current=location]:text-background"
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

/** A strip of film under the beats, edge-printed with the house stock and the beat numbers. Director's cut only. */
function FilmEdge({ count }: { count: number }) {
  const holes = "mx-2.5 h-2.5 rounded-[3px] bg-[repeating-linear-gradient(90deg,#f2f0ea_0_14px,transparent_14px_26px)]";
  return (
    <div aria-hidden className="flex flex-col gap-2 rounded-2xl bg-[#1b1a17] py-2.5 print:hidden">
      <span className={holes} />
      <span className="truncate px-4 font-mono text-[14px] tracking-[0.14em] text-[#f2b33d]">
        ITSGIVING 400 {Array.from({ length: count }, (_, i) => `▸ ${i + 1}`).join(" ")}
      </span>
      <span className={holes} />
    </div>
  );
}

/** Halfway down the board, an interval card, the way a Hindi film breaks for chai. Director's cut only. */
function Interval() {
  const lingo = useLingo().t;
  return (
    <aside
      aria-label={lingo.interval.title}
      className="flex flex-col items-center gap-2 rounded-[28px] bg-[#7a1238] px-6 py-10 text-center print:hidden"
    >
      <p
        className="text-[clamp(2.75rem,6vw,4rem)] leading-none tracking-[0.04em] text-[#ffe7a3]"
        style={{ fontFamily: "var(--font-tc-yatra), serif" }}
      >
        {lingo.interval.title}
      </p>
      <p className="text-[16px] text-[#fff3d6]">{lingo.interval.line}</p>
    </aside>
  );
}

/**
 * A digicam's date stamp, 'YY MM DD, for the day the treatment was built. In UTC, so a board rendered on the server
 * (a featured page) reads the same in every visitor's browser.
 */
function dateStamp(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `'${two(d.getUTCFullYear() % 100)} ${two(d.getUTCMonth() + 1)} ${two(d.getUTCDate())}`;
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
}) {
  const lingo = useLingo().t;
  const mock = t.mock.qloo;
  const source = mock ? "the synthetic mock, not Qloo" : "Qloo";
  const templated = t.llm.filter((l) => l.producedBy.mock).map((l) => STEP_NAME[l.step].toLowerCase());
  const suggestion = suggestTitleFont(t);
  // The suggestion follows each rework until the director picks a face themselves.
  const [picked, setPicked] = useState<string | null>(null);
  const fontId = picked ?? suggestion.id;
  const stamp = dateStamp(t.createdAt);
  const cover = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);
  // Where the shoot-base map exists, it stays put beside the locations and lights the pin of the one being read.
  const pinned = (t.base?.map?.tiles.length ?? 0) > 0 && t.locations.length > 0;
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
      aria-labelledby="treatment-title"
      aria-busy={state === "updating"}
      className={`flex flex-col gap-14 transition-opacity duration-300 ${state === "current" ? "" : "opacity-50"}`}
    >
      {state === "previous" && (
        <p className="-mb-8 text-[15px] text-dim">
          This is the previous version. The latest change didn&apos;t finish, so nothing below reflects it.
        </p>
      )}
      <div className="flex flex-col gap-6">
        <Cover ref={cover} t={t} fontId={fontId} suggestion={suggestion} onPickFont={setPicked} />
        <Giving t={t} mock={mock} />
        <Rework nudges={nudges} onToggle={onToggleNudge} running={running} take={take} note={reworkNote} />
      </div>

      <SectionBar t={t} fontId={fontId} take={take} running={running} cover={cover} article={article} back={back} />

      <Section id="concept" title="Concept">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <p className="max-w-[44ch] font-serif text-[clamp(1.5rem,2.3vw,1.9rem)] leading-[1.32] text-pretty">{t.concept}</p>
          {t.tone.length > 0 && (
            <div className={`${card} flex flex-col gap-4 p-5`}>
              <h4 className="text-[14px] font-semibold text-dim">How the tone reads</h4>
              <ul className="flex flex-col gap-4">
                {t.tone.map((tone) => (
                  <li key={tone.tag.id} className="flex flex-col gap-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className={`font-mono font-semibold ${evidenceTone(mock)}`}>{tone.tag.name}</span>
                      <span className="text-faint">{tone.source === "overlap" ? lingo.shared : "audience taste"}</span>
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
        note={`Films this audience over-indexes on, ranked by ${source}. itsgiving wrote the notes.`}
      >
        {t.references.length === 0 ? (
          <p className="text-[15px] text-dim">{mock ? "The mock" : "Qloo"} returned no reference films for this brief.</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {t.references.map((r) => (
              <li key={r.entity.id} className={`${card} flex flex-col overflow-hidden`}>
                <Still src={r.entity.image} alt={`Still from ${r.entity.name}`} className="aspect-video w-full" />
                <div className="flex flex-1 flex-col gap-3.5 p-5">
                  <div className="flex flex-col gap-1">
                    <h4 className="type-head text-[1.7rem] leading-tight">
                      {r.entity.name}
                      {r.entity.year && <span className="ml-2 text-[1.1rem] font-normal tracking-normal text-faint">{r.entity.year}</span>}
                    </h4>
                    <QlooTags tags={r.qloo.tags} />
                  </div>
                  <p className="font-serif text-[1.15rem] leading-snug text-dim">{r.notes.why}</p>
                  <p className={prose}>
                    <span className="font-sans text-[13px] font-semibold text-faint">Borrow </span>
                    {r.notes.borrow}
                  </p>
                  <Receipt qloo={r.qloo} mock={mock} className="mt-auto" />
                  <Why
                    label="Why this film"
                    name={r.entity.name}
                    qloo={r.qloo}
                    read={[
                      { term: "Why it fits", text: r.notes.why },
                      { term: "What to borrow", text: r.notes.borrow },
                    ]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Also label="Also high for this audience:" items={t.extras.references} mock={mock} />
      </Section>

      <Section id="beats" title="Beats">
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {t.beats.map((beat, i) => (
            <li key={i} className={`${card} flex flex-col gap-2.5 p-5`}>
              <span aria-hidden className="type-poster text-[3.25rem] text-foreground/20">
                {i + 1}
              </span>
              <h4 className="type-head text-[1.45rem] leading-tight">{beat.title}</h4>
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
        note={`Brands this audience over-indexes on, ranked by ${source}. itsgiving wrote the looks.`}
      >
        {t.wardrobe.length === 0 ? (
          <p className="text-[15px] text-dim">{mock ? "The mock" : "Qloo"} returned no brands for this brief.</p>
        ) : (
          <ul className="grid gap-5 md:grid-cols-2">
            {t.wardrobe.map((w) => (
              <li key={w.entity.id} className={`${card} flex flex-col gap-3.5 p-5`}>
                <div className="flex flex-col gap-1">
                  <h4 className="type-head text-[1.7rem] leading-tight">{w.entity.name}</h4>
                  <QlooTags tags={w.qloo.tags} />
                </div>
                <p className={prose}>{w.notes.look}</p>
                <Receipt qloo={w.qloo} mock={mock} className="mt-auto" />
                <Why
                  label="Why this brand"
                  name={w.entity.name}
                  qloo={w.qloo}
                  read={[{ term: "The look", text: w.notes.look }]}
                  writtenBy={t.writtenBy}
                  mock={mock}
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
          <div className={pinned ? "lg:sticky lg:top-20" : ""}>
            <ShootBaseBlock
              base={t.base}
              pins={locationPins(t)}
              city={t.brief.city}
              audience={audiencePhrase(t.subjects)}
              mock={mock}
              active={pinned ? reading : undefined}
              compact={pinned}
            />
          </div>
          {t.locations.length === 0 ? (
            <p className="text-[15px] text-dim">No locations came back for {t.brief.city}. Check the city name, or try a nearby one.</p>
          ) : (
            <ul className={pinned ? "flex flex-col gap-5" : "grid gap-5 sm:grid-cols-2 xl:grid-cols-3"}>
              {t.locations.map((l, i) => {
                const place = l.entity.place;
                const where = [place?.kind, place?.neighborhood, place?.price_level ? `price level ${place.price_level} of 4` : undefined]
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
                    className={`${card} flex flex-col overflow-hidden ${pinned && reading === i ? "ring-2 ring-foreground" : ""}`}
                  >
                    <div className="relative">
                      <Still
                        src={l.entity.image}
                        alt={`Photo of ${l.entity.name}`}
                        className={`${pinned ? "aspect-video" : "aspect-[3/2]"} w-full`}
                      />
                      <span
                        aria-hidden
                        className="absolute right-3 bottom-2.5 rounded-md bg-black/45 px-1.5 font-mono text-[17px] font-semibold tracking-[0.08em] text-[#ff9a3c] [text-shadow:0_0_6px_rgb(255_140_40/0.8)]"
                      >
                        {stamp}
                      </span>
                      {t.base?.map && map && (
                        <span
                          className={`absolute top-3 left-3 grid size-8 place-items-center rounded-full text-[14px] font-bold ${
                            pinned && reading === i ? "bg-accent text-[#121211]" : "bg-[#121211] text-white"
                          }`}
                        >
                          <span className="sr-only">Location </span>
                          {i + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div>
                        <h4 className="type-head text-[1.6rem] leading-tight">{l.entity.name}</h4>
                        {where && <p className="mt-1 text-[14px] text-faint">{where}</p>}
                      </div>
                      {place?.ambience && (
                        <p className="line-clamp-3 text-[14px] leading-5 text-dim">
                          <span className={`font-mono text-[12px] font-semibold ${evidenceTone(mock)}`}>
                            {mock ? "Mock note" : "Qloo"}{" "}
                          </span>
                          {place.ambience}
                        </p>
                      )}
                      <p className={prose}>{l.notes.scene}</p>
                      <Receipt qloo={l.qloo} mock={mock} className="mt-auto" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Why
                          label="Why this place"
                          name={l.entity.name}
                          qloo={l.qloo}
                          note={place?.ambience}
                          read={[{ term: "The scene", text: l.notes.scene }]}
                          writtenBy={t.writtenBy}
                          mock={mock}
                        />
                        {map && (
                          <a
                            href={map}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full px-3 py-2 text-sm font-semibold underline decoration-edge underline-offset-4 hover:decoration-foreground"
                          >
                            Map<span className="sr-only"> of {l.entity.name} (opens in a new tab)</span>
                          </a>
                        )}
                      </div>
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
        <div className="grid gap-5 md:grid-cols-2">
          {(
            [
              ["Lighting", t.lighting],
              ["Shots", t.shots],
            ] as const
          ).map(([label, lines]) => (
            <div key={label} className={`${card} p-5`}>
              <h4 className="text-[14px] font-semibold text-dim">{label}</h4>
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

      <Section id="palette" title="Palette">
        <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {t.palette.map((c) => (
            <li key={c.hex}>
              <span aria-hidden className="block aspect-[4/5] w-full rounded-[20px] ring-1 ring-black/10" style={{ background: c.hex }} />
              <span className="mt-2 block text-[15px] leading-tight font-semibold">{c.name}</span>
              <span className="block font-mono text-[13px] text-faint">{c.hex}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="audience"
        title="Audience"
        note={
          mock
            ? "Synthetic fixtures standing in for Qloo's taste graph: real names, invented affinities."
            : "What Qloo's taste graph says about this audience: aggregate affinities, never facts about any one person."
        }
      >
        <div className={`${card} p-6`}>
          <dl className="grid gap-x-10 gap-y-6 md:grid-cols-[14rem_minmax(0,1fr)]">
            {t.audience.overlap.length > 0 && (
              <>
                <dt className="text-[15px] font-semibold">Shared by your films and the audience</dt>
                <dd>
                  <EvidenceChips tags={t.audience.overlap} mock={mock} shared />
                </dd>
              </>
            )}
            <dt className="text-[15px] font-semibold">The audience over-indexes on</dt>
            <dd>
              {t.audience.taste_tags.length > 0 ? (
                <EvidenceChips tags={t.audience.taste_tags} mock={mock} />
              ) : (
                <p className="text-[15px] text-dim">No taste tags came back.</p>
              )}
            </dd>
            {t.audience.leans.length > 0 && (
              <>
                <dt className="text-[15px] font-semibold">Who over-indexes</dt>
                <dd className={`font-mono text-[13px] leading-6 ${evidenceTone(mock)}`}>{t.audience.leans.join("; ")}</dd>
              </>
            )}
          </dl>
        </div>
      </Section>

      <Section id="credits" title="Credits">
        <div className="grid gap-5 xl:grid-cols-2">
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
                  <dt className="text-faint">Your taste</dt>
                  <dd>
                    {names(t.director.slice(0, 8))}
                    {t.director.length > 8 ? ` and ${t.director.length - 8} more` : ""}
                  </dd>
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
