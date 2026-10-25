"use client";

import { Fragment, type ReactNode } from "react";
import { BUDGETS, FORMATS, NUDGES, NUDGE_LABELS, subjectPhrase, type Nudge } from "@/lib/agent/options";
import type { Example } from "@/lib/agent/examples";
import type { FeaturedCover } from "@/lib/agent/featured";
import type { LlmStep, Treatment } from "@/lib/agent/types";
import type { CompactEntity, CompactTag } from "@/lib/qloo/normalize";
import { EdgeCode, QlooTags, Still, Tape, Why, modelName } from "./parts";

const STEP_NAME: Record<LlmStep, string> = { plan: "Plan", replan: "Re-plan", write: "Writing" };

/** The treatment's sections, in reading order, for the index under the cover. */
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

/** Mise's own writing is set in the document face; the tool, labels and evidence stay in the interface face. */
const prose = "font-serif text-[15.5px] leading-[1.65] text-paper/88";

/**
 * A titled section of the treatment. On wide screens the title sits in its own column and stays in view
 * while the section scrolls, the way a printed treatment labels its pages.
 */
function Section({ id, title, note, first, children }: { id: string; title: string; note?: string; first?: boolean; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className={`scroll-mt-32 xl:grid xl:grid-cols-[11rem_minmax(0,1fr)] xl:gap-10 ${first ? "" : "border-t border-line pt-8"}`}
    >
      <div className="xl:sticky xl:top-32 xl:self-start">
        <h3 id={id} className="type-head text-[1.75rem] leading-none text-paper">
          {title}
        </h3>
      </div>
      <div className="mt-4 min-w-0 xl:mt-0">
        {note && <p className="mb-6 max-w-[70ch] text-sm leading-6 text-dim">{note}</p>}
        {children}
      </div>
    </section>
  );
}

function names(entities: CompactEntity[]): string {
  return entities.map((e) => `${e.name}${e.year ? ` (${e.year})` : ""}`).join(", ");
}

/** Tungsten marks Qloo evidence; tape pink marks the synthetic mock standing in for it. */
const evidenceTone = (mock: boolean) => (mock ? "text-tape" : "text-tungsten");

function TagList({ tags, mock }: { tags: CompactTag[]; mock: boolean }) {
  return (
    <ul className={`type-evidence flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] leading-5 ${evidenceTone(mock)}`}>
      {tags.map((tag) => (
        <li key={tag.id}>{tag.name}</li>
      ))}
    </ul>
  );
}

function Also({ label, items, mock }: { label: string; items: CompactEntity[]; mock: boolean }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-8 text-sm leading-6 text-dim">
      {label} <span className={`type-evidence text-[13px] ${evidenceTone(mock)}`}>{names(items)}</span>
    </p>
  );
}

function Cover({ t }: { t: Treatment }) {
  // Mock placeholders carry their own "not Qloo data" text, which would fight the title.
  const still = t.references.find((r) => r.entity.image && !r.entity.image.startsWith("/mock/"))?.entity.image;
  const [a, b] = [t.palette[0]?.hex ?? "#1A1917", t.palette[1]?.hex ?? "#2B2925"];
  const subject = subjectPhrase(
    t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
    t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
  );
  return (
    // No overflow-hidden and an automatic min-height: an aspect-ratio box only grows to fit a long title with both.
    <header
      key={`${t.id}-${t.createdAt}`}
      className="letterbox-open relative isolate flex min-h-[30rem] flex-col justify-between rounded-[3px] bg-frame sm:aspect-[2.39/1] sm:min-h-auto"
    >
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden rounded-[3px]">
        {still && <Still src={still} alt="" className="absolute inset-0 size-full opacity-35 grayscale" />}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(100deg, #0a0908 12%, ${a}55 60%, ${b}33 100%), linear-gradient(0deg, #0a0908 0%, transparent 70%)`,
          }}
        />
      </div>
      <p className="flex flex-wrap items-center gap-3 p-6 text-[13px] text-paper/75 sm:p-10">
        <span>
          {FORMATS[t.brief.format]} {subject} / {t.brief.city} / {BUDGETS[t.brief.budget].label} budget
        </span>
        {t.mock.qloo && <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>}
      </p>
      <div className="px-6 pb-8 sm:px-10 sm:pb-10">
        <h2 id="treatment-title" tabIndex={-1} className="type-poster max-w-[15ch] text-[clamp(3rem,7vw,7rem)] text-balance text-paper">
          {t.title}
        </h2>
        <p className="mt-5 max-w-[48ch] font-serif text-lg leading-7 text-pretty text-paper/85 sm:text-xl sm:leading-8">{t.logline}</p>
      </div>
      <ul aria-label="Palette" className="flex h-2 shrink-0">
        {t.palette.map((c) => (
          <li key={c.hex} title={`${c.name} ${c.hex}`} className="flex-1" style={{ background: c.hex }}>
            <span className="sr-only">
              {c.name} {c.hex}
            </span>
          </li>
        ))}
      </ul>
    </header>
  );
}

function Rework({ nudges, onToggle, running }: { nudges: Nudge[]; onToggle: (nudge: Nudge) => void; running: boolean }) {
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div role="group" aria-label="Rework this treatment" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-dim">Rework it</span>
        {NUDGES.map((nudge) => (
          <button
            key={nudge}
            type="button"
            aria-pressed={nudges.includes(nudge)}
            aria-disabled={running}
            onClick={() => onToggle(nudge)}
            className="rounded-full bg-graphite px-3.5 py-1.5 text-sm text-paper ring-1 ring-line hover:ring-edge aria-disabled:cursor-progress aria-disabled:opacity-50 aria-pressed:bg-paper aria-pressed:text-ink aria-pressed:ring-paper"
          >
            {NUDGE_LABELS[nudge]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-md px-3.5 py-1.5 text-sm text-dim ring-1 ring-edge hover:text-paper hover:ring-dim"
        >
          Save as PDF
        </button>
      </div>
      <p className="text-xs text-faint">Each change re-runs the plan and the writing. Qloo lookups are cached.</p>
    </div>
  );
}

function SectionIndex() {
  return (
    // The negative margins match the stage's padding so the bar spans it edge to edge.
    <nav
      aria-label="Treatment sections"
      className="sticky top-14 z-20 -mx-4 border-b border-line bg-background/90 px-4 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12 xl:-mx-16 xl:px-16 print:hidden"
    >
      <ul className="flex gap-6 overflow-x-auto py-3 text-sm text-dim">
        {SECTIONS.map(([id, label]) => (
          <li key={id} className="shrink-0">
            <a href={`#${id}`} className="rounded-sm hover:text-paper">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Board({
  treatment: t,
  state,
  nudges,
  onToggleNudge,
  running,
}: {
  treatment: Treatment;
  /** updating: a re-run is in flight; previous: the last re-run failed, so this is the older version. */
  state: "current" | "updating" | "previous";
  nudges: Nudge[];
  onToggleNudge: (nudge: Nudge) => void;
  running: boolean;
}) {
  const mock = t.mock.qloo;
  const source = mock ? "the synthetic mock, not Qloo" : "Qloo";
  const templated = t.llm.filter((l) => l.producedBy.mock).map((l) => STEP_NAME[l.step].toLowerCase());
  return (
    <article
      aria-labelledby="treatment-title"
      aria-busy={state === "updating"}
      className={`flex flex-col gap-12 transition-opacity duration-300 ${state === "current" ? "" : "opacity-50"}`}
    >
      {state === "previous" && (
        <p className="-mb-6 text-sm text-dim">This is the previous version. The latest change didn&apos;t finish, so nothing below reflects it.</p>
      )}
      <div className="flex flex-col gap-5">
        <Cover t={t} />
        <Rework nudges={nudges} onToggle={onToggleNudge} running={running} />
      </div>

      <SectionIndex />

      <Section id="concept" title="Concept" first>
        <div className="grid gap-10 2xl:grid-cols-[minmax(0,1fr)_21rem]">
          <p className="max-w-[60ch] font-serif text-[1.1875rem] leading-[1.7] text-pretty text-paper/90">{t.concept}</p>
          {t.tone.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-dim">Tone</h4>
              <ul className="mt-3 flex flex-col gap-4">
                {t.tone.map((tone) => (
                  <li key={tone.tag.id}>
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                      <span className={`type-evidence ${evidenceTone(mock)}`}>{tone.tag.name}</span>
                      <span className="text-dim">{tone.source === "overlap" ? "shared with your taste" : "audience taste"}</span>
                    </p>
                    <p className={`mt-1 ${prose}`}>{tone.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section id="references" title="References" note={`Films this audience over-indexes on, ranked by ${source}. The notes are Mise's.`}>
        {t.references.length === 0 ? (
          <p className="text-sm text-dim">{mock ? "The mock" : "Qloo"} returned no reference films for this brief.</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-12 sm:grid-cols-2 2xl:grid-cols-3">
            {t.references.map((r) => (
              <li key={r.entity.id} className="flex flex-col">
                <Still src={r.entity.image} alt={`Still from ${r.entity.name}`} className="aspect-video w-full rounded-[3px]" />
                <div className="mt-4 flex items-baseline justify-between gap-3">
                  <h4 className="type-head text-xl leading-tight">{r.entity.name}</h4>
                  {r.entity.year && <span className="type-evidence shrink-0 text-xs text-dim">{r.entity.year}</span>}
                </div>
                <div className="mt-1 flex flex-col">
                  <EdgeCode qloo={r.qloo} mock={mock} />
                  <QlooTags tags={r.qloo.tags} />
                </div>
                <p className={`mt-3 ${prose}`}>{r.notes.why}</p>
                <p className={`mt-2 ${prose}`}>
                  <span className="font-sans text-[13px] font-medium text-dim">Borrow </span>
                  {r.notes.borrow}
                </p>
                <div className="mt-3">
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
        <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 2xl:grid-cols-3">
          {t.beats.map((beat, i) => (
            <li key={i} className="border-t border-edge/50 pt-4">
              <p aria-hidden className="type-poster text-4xl text-paper/25">
                {i + 1}
              </p>
              <h4 className="type-head mt-3 text-xl leading-tight">{beat.title}</h4>
              <p className={`mt-2 ${prose}`}>{beat.description}</p>
              {beat.reference && <p className="mt-2 text-xs text-dim">After {beat.reference.name}</p>}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="wardrobe" title="Wardrobe" note={`Brands this audience over-indexes on, ranked by ${source}. The looks are Mise's.`}>
        {t.wardrobe.length === 0 ? (
          <p className="text-sm text-dim">{mock ? "The mock" : "Qloo"} returned no brands for this brief.</p>
        ) : (
          <ul className="grid gap-x-10 gap-y-10 md:grid-cols-2">
            {t.wardrobe.map((w) => (
              <li key={w.entity.id} className="flex flex-col border-t border-edge/50 pt-4">
                <h4 className="type-head text-xl leading-tight">{w.entity.name}</h4>
                <div className="mt-1 flex flex-col">
                  <EdgeCode qloo={w.qloo} mock={mock} />
                  <QlooTags tags={w.qloo.tags} />
                </div>
                <p className={`mt-3 ${prose}`}>{w.notes.look}</p>
                <div className="mt-3">
                  <Why
                    label="Why this brand"
                    name={w.entity.name}
                    qloo={w.qloo}
                    read={[{ term: "The look", text: w.notes.look }]}
                    writtenBy={t.writtenBy}
                    mock={mock}
                  />
                </div>
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
        {t.locations.length === 0 ? (
          <p className="text-sm text-dim">No locations came back for {t.brief.city}. Check the city name, or try a nearby one.</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-12 sm:grid-cols-2 2xl:grid-cols-3">
            {t.locations.map((l) => {
              const place = l.entity.place;
              const where = [place?.kind, place?.neighborhood, place?.price_level ? `price level ${place.price_level} of 4` : undefined]
                .filter(Boolean)
                .join(", ");
              const map =
                place?.lat !== undefined && place?.lon !== undefined
                  ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`
                  : undefined;
              return (
                <li key={l.entity.id} className="flex flex-col">
                  <Still src={l.entity.image} alt={`Photo of ${l.entity.name}`} className="aspect-[3/2] w-full rounded-[3px]" />
                  <h4 className="type-head mt-4 text-xl leading-tight">{l.entity.name}</h4>
                  {where && <p className="mt-0.5 text-xs text-dim">{where}</p>}
                  <div className="mt-1">
                    <EdgeCode qloo={l.qloo} mock={mock} />
                  </div>
                  {place?.ambience && (
                    <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-dim">
                      <span className={`type-evidence text-[11.5px] ${evidenceTone(mock)}`}>{mock ? "Mock note" : "Qloo"} </span>
                      {place.ambience}
                    </p>
                  )}
                  <p className={`mt-3 ${prose}`}>{l.notes.scene}</p>
                  <div className="mt-3 flex items-center gap-4">
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
                      <a href={map} target="_blank" rel="noreferrer" className="text-xs text-dim underline decoration-edge underline-offset-4 hover:text-paper">
                        Map<span className="sr-only"> of {l.entity.name} (opens in a new tab)</span>
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Also label="More to scout:" items={t.extras.locations} mock={mock} />
      </Section>

      <Section id="camera" title="Camera and light">
        <div className="grid gap-10 md:grid-cols-2">
          {(
            [
              ["Lighting", t.lighting],
              ["Shots", t.shots],
            ] as const
          ).map(([label, lines]) => (
            <div key={label}>
              <h4 className="text-[13px] font-medium text-dim">{label}</h4>
              <ul className="mt-3 flex flex-col divide-y divide-line border-y border-line">
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
              <span aria-hidden className="block aspect-[4/5] w-full rounded-[3px] ring-1 ring-white/10" style={{ background: c.hex }} />
              <span className="mt-2 block text-sm leading-tight">{c.name}</span>
              <span className="type-evidence block text-xs text-dim">{c.hex}</span>
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
        <dl className="grid gap-x-10 gap-y-6 md:grid-cols-[13rem_minmax(0,1fr)]">
          {t.audience.overlap.length > 0 && (
            <>
              <dt className="text-sm text-paper">Shared by your films and the audience</dt>
              <dd>
                <TagList tags={t.audience.overlap} mock={mock} />
              </dd>
            </>
          )}
          <dt className="text-sm text-paper">The audience over-indexes on</dt>
          <dd>{t.audience.taste_tags.length > 0 ? <TagList tags={t.audience.taste_tags} mock={mock} /> : <p className="text-sm text-dim">No taste tags came back.</p>}</dd>
          {t.audience.leans.length > 0 && (
            <>
              <dt className="text-sm text-paper">Who over-indexes</dt>
              <dd className={`type-evidence text-[13px] leading-5 ${evidenceTone(mock)}`}>{t.audience.leans.join("; ")}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section id="credits" title="Credits">
        <dl className="grid gap-x-10 gap-y-3 text-sm leading-6 md:grid-cols-[13rem_minmax(0,1fr)]">
          <dt className="text-dim">Built</dt>
          <dd>{new Date(t.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
          <dt className="text-dim">Data</dt>
          <dd>
            {t.qloo.calls} {mock ? "mock " : ""}Qloo requests
          </dd>
          {t.llm.map((l) => (
            <Fragment key={l.step}>
              <dt className="text-dim">{STEP_NAME[l.step]}</dt>
              <dd>{modelName(l.producedBy)}</dd>
            </Fragment>
          ))}
          <dt className="text-dim">Creative direction</dt>
          <dd className={prose}>{t.direction}</dd>
        </dl>
        {t.notes.length > 0 && (
          <ul className="mt-6 flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-dim marker:text-edge">
            {t.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
        {t.mock.qloo && (
          <p className="mt-4 text-sm text-tape">Mock data: the names are real, but every score, tag, photo and ranking here is synthetic, not Qloo&apos;s.</p>
        )}
        {templated.length > 0 && (
          <p className="mt-2 text-sm text-tape">
            Mock LLM: a deterministic template did the {templated.join(" and ")} {templated.length === 1 ? "step" : "steps"}, not a language model.
          </p>
        )}
      </Section>
    </article>
  );
}

/** The steps a treatment goes through, in order: what the run log will show. */
const PIPELINE = [
  ["Resolve the names", "Your artist and films become Qloo entities. A title that matches several asks which one."],
  ["Read the audience", "What these fans over-index on, and where it meets your own taste."],
  ["Plan the direction", "The model picks a direction and the style words to look up."],
  ["Scout with Qloo", "Reference films, wardrobe brands and real places in your city."],
  ["Write the treatment", "It cites only films, brands and places Qloo returned."],
] as const;

/** A featured treatment's cover in miniature: the same projected frame, title and palette as the board. */
function CoverCard({ cover, onOpen }: { cover: FeaturedCover; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative isolate flex aspect-[2.39/1] w-full flex-col justify-end overflow-hidden rounded-[3px] bg-frame p-5 text-left ring-1 ring-line hover:ring-edge sm:p-6"
    >
      {cover.still && <Still src={cover.still} alt="" className="absolute inset-0 -z-10 size-full opacity-30 grayscale" />}
      <span aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,#0a0908_20%,transparent_90%)]" />
      <span className="text-xs text-paper/70">{cover.line}</span>
      <span className="type-poster mt-1.5 text-[clamp(1.75rem,2.4vw,2.5rem)] text-balance text-paper">{cover.title}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 flex h-1">
        {cover.palette.map((hex) => (
          <span key={hex} className="flex-1" style={{ background: hex }} />
        ))}
      </span>
    </button>
  );
}

export function EmptyBoard({ examples, covers, onTry }: { examples: Example[]; covers: FeaturedCover[]; onTry: (example: Example) => void }) {
  const coverOf = (example: Example) => covers.find((c) => c.slug === example.slug);
  const featured = examples.filter(coverOf);
  const plain = examples.filter((e) => !coverOf(e));
  return (
    <div className="flex flex-col gap-14">
      {/* The empty frame, waiting for its first title card. */}
      <div className="flex min-h-[24rem] flex-col justify-end rounded-[3px] bg-frame p-6 sm:aspect-[2.39/1] sm:min-h-auto sm:p-10">
        <h2 className="type-poster max-w-[13ch] text-[clamp(3rem,7vw,7rem)] text-balance text-paper">Your voice, their taste.</h2>
        <p className="mt-5 max-w-[54ch] text-base leading-7 text-pretty text-dim sm:text-lg sm:leading-8">
          Give Mise an artist, a shoot city and a budget. It reads what that audience loves on Qloo, then writes a treatment you can
          pitch: reference films, wardrobe, real locations, and the evidence behind every pick.
        </p>
      </div>

      {featured.length > 0 && (
        <section aria-labelledby="featured-heading">
          <h3 id="featured-heading" className="text-[13px] font-medium text-dim">
            Featured treatments
          </h3>
          <p className="mt-1 text-sm leading-6 text-faint">Built ahead of time from live Qloo data, so they open at once. Rework any of them, or write your own brief.</p>
          <ul className="mt-4 grid gap-4 lg:grid-cols-2">
            {featured.map((example) => (
              <li key={example.slug}>
                <CoverCard cover={coverOf(example)!} onOpen={() => onTry(example)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="how-heading">
        <h3 id="how-heading" className="text-[13px] font-medium text-dim">
          How a treatment gets made
        </h3>
        <ol className="mt-4 grid gap-x-8 gap-y-6 border-t border-line pt-5 sm:grid-cols-2 xl:grid-cols-5">
          {PIPELINE.map(([title, text], i) => (
            <li key={title}>
              <p aria-hidden className="type-poster text-3xl text-paper/25">
                {i + 1}
              </p>
              <p className="type-head mt-2 text-lg leading-tight text-paper">{title}</p>
              <p className="mt-1 text-sm leading-6 text-dim">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {plain.length > 0 && (
        <section aria-labelledby="examples-heading">
          <h3 id="examples-heading" className="text-[13px] font-medium text-dim">
            {featured.length > 0 ? "Or try a live run" : "Start from an example"}
          </h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {plain.map((example) => (
              <li key={example.slug}>
                <button
                  type="button"
                  onClick={() => onTry(example)}
                  className="flex h-full w-full flex-col items-start gap-1 rounded-lg bg-graphite p-4 text-left ring-1 ring-line hover:ring-edge"
                >
                  <span className="type-head text-xl leading-tight text-paper">{example.title}</span>
                  <span className="text-sm leading-6 text-dim">{example.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
