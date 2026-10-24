"use client";

import type { ReactNode } from "react";
import { BUDGETS, FORMATS, NUDGES, NUDGE_LABELS, subjectPhrase, type Nudge } from "@/lib/agent/options";
import type { LlmStep, Treatment } from "@/lib/agent/types";
import type { CompactEntity, CompactTag } from "@/lib/qloo/normalize";
import { EdgeCode, Still, Why, modelName } from "./parts";

const STEP_NAME: Record<LlmStep, string> = { plan: "Plan", replan: "Re-plan", write: "Writing" };

function Section({ title, note, children, id }: { title: string; note?: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="text-xl font-semibold tracking-tight text-paper">
        {title}
      </h3>
      {note && <p className="mt-1 max-w-[70ch] text-sm text-dim">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function names(entities: CompactEntity[]): string {
  return entities.map((e) => `${e.name}${e.year ? ` (${e.year})` : ""}`).join(", ");
}

function TagList({ tags }: { tags: CompactTag[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs leading-5 text-tungsten">
      {tags.map((tag) => (
        <li key={tag.id}>{tag.name}</li>
      ))}
    </ul>
  );
}

function Cover({ t }: { t: Treatment }) {
  // Mock placeholders carry their own "not Qloo data" text, which would fight the title.
  const still = t.references.find((r) => r.entity.image && !r.entity.image.startsWith("/mock/"))?.entity.image;
  const [a, b] = [t.palette[0]?.hex ?? "#1C1917", t.palette[1]?.hex ?? "#292524"];
  const subject = subjectPhrase(
    t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
    t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
  );
  return (
    // No overflow-hidden here: an aspect-ratio box only grows to fit long titles while overflow is visible.
    <header
      key={`${t.id}-${t.createdAt}`}
      className="letterbox-open relative isolate flex min-h-[26rem] flex-col justify-between rounded-sm bg-ink ring-1 ring-line sm:aspect-[2.39/1] sm:min-h-0"
    >
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden rounded-sm">
        {still && <Still src={still} alt="" className="absolute inset-0 size-full opacity-30 grayscale" />}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(115deg, ${a}CC 0%, ${b}55 45%, transparent 75%), linear-gradient(0deg, #0c0a09 5%, transparent 65%)`,
          }}
        />
      </div>
      <p className="p-5 text-xs text-paper/80 sm:p-8">
        {FORMATS[t.brief.format]} {subject} / {t.brief.city} / {BUDGETS[t.brief.budget].label} budget
      </p>
      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <h2 id="treatment-title" className="max-w-4xl text-[clamp(2.25rem,6vw,5.25rem)] font-semibold leading-[0.92] tracking-[-0.03em] text-balance">
          {t.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-pretty text-paper/85 sm:text-lg">{t.logline}</p>
      </div>
      <ul aria-label="Palette" className="flex h-2.5">
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
        <span className="mr-1 text-sm text-dim">Rework it:</span>
        {NUDGES.map((nudge) => (
          <button
            key={nudge}
            type="button"
            aria-pressed={nudges.includes(nudge)}
            disabled={running}
            onClick={() => onToggle(nudge)}
            className="rounded-full px-3 py-1.5 text-sm text-paper ring-1 ring-line hover:ring-dim disabled:cursor-progress disabled:opacity-50 aria-pressed:bg-paper aria-pressed:text-ink aria-pressed:ring-paper"
          >
            {NUDGE_LABELS[nudge]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-dim ring-1 ring-line hover:text-paper hover:ring-dim"
        >
          Save as PDF
        </button>
      </div>
      <p className="text-xs text-faint">Each change re-runs the plan and the writing. Qloo lookups are cached.</p>
    </div>
  );
}

export function Board({
  treatment: t,
  stale,
  nudges,
  onToggleNudge,
  running,
}: {
  treatment: Treatment;
  stale: boolean;
  nudges: Nudge[];
  onToggleNudge: (nudge: Nudge) => void;
  running: boolean;
}) {
  return (
    <article aria-labelledby="treatment-title" aria-busy={stale} className={`flex flex-col gap-14 transition-opacity duration-300 ${stale ? "opacity-40" : ""}`}>
      <div className="flex flex-col gap-5">
        <Cover t={t} />
        <Rework nudges={nudges} onToggle={onToggleNudge} running={running} />
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="concept">
          <h3 id="concept" className="text-xl font-semibold tracking-tight">
            Concept
          </h3>
          <p className="mt-4 max-w-[65ch] text-lg leading-8 text-pretty text-paper/90">{t.concept}</p>
        </section>
        <section aria-labelledby="tone">
          <h3 id="tone" className="text-xl font-semibold tracking-tight">
            Tone
          </h3>
          <ul className="mt-4 flex flex-col gap-4">
            {t.tone.map((tone) => (
              <li key={tone.tag.id}>
                <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-tungsten">
                  {tone.tag.name}
                  <span className="text-dim">{tone.source === "overlap" ? "shared with your taste" : "audience taste"}</span>
                </p>
                <p className="mt-1 text-sm leading-6 text-paper/85">{tone.note}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Section id="references" title="Reference films" note="Films this audience over-indexes on, ranked by Qloo. The notes are Mise's.">
        {t.references.length === 0 ? (
          <p className="text-sm text-dim">Qloo returned no reference films for this brief.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {t.references.map((r) => (
              <li key={r.entity.id} className="flex flex-col gap-2">
                <Still src={r.entity.image} alt={`Still from ${r.entity.name}`} className="aspect-video w-full rounded-sm" />
                <h4 className="mt-1 text-base font-medium leading-snug">
                  {r.entity.name} {r.entity.year && <span className="font-normal text-dim">{r.entity.year}</span>}
                </h4>
                <EdgeCode qloo={r.qloo} />
                <p className="text-sm leading-6 text-paper/85">{r.notes.why}</p>
                <p className="text-sm leading-6">
                  <span className="text-dim">Borrow: </span>
                  {r.notes.borrow}
                </p>
                <Why
                  label="Why this film"
                  name={r.entity.name}
                  qloo={r.qloo}
                  read={[
                    { term: "Why it fits", text: r.notes.why },
                    { term: "What to borrow", text: r.notes.borrow },
                  ]}
                  writtenBy={t.writtenBy}
                />
              </li>
            ))}
          </ul>
        )}
        {t.extras.references.length > 0 && (
          <p className="mt-8 text-sm text-dim">
            Also high for this audience: <span className="font-mono text-xs text-tungsten">{names(t.extras.references)}</span>
          </p>
        )}
      </Section>

      <Section id="beats" title="Beats">
        <ol className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {t.beats.map((beat, i) => (
            <li key={i} className="border-t border-line pt-3">
              <p className="text-xs tabular-nums text-dim">Beat {i + 1}</p>
              <h4 className="mt-1 text-base font-medium">{beat.title}</h4>
              <p className="mt-1 text-sm leading-6 text-paper/85">{beat.description}</p>
              {beat.reference && <p className="mt-2 text-xs text-dim">After {beat.reference.name}</p>}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="wardrobe" title="Wardrobe" note="Brands this audience over-indexes on, ranked by Qloo. The looks are Mise's.">
        {t.wardrobe.length === 0 ? (
          <p className="text-sm text-dim">Qloo returned no brands for this brief.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {t.wardrobe.map((w) => (
              <li key={w.entity.id} className="grid gap-3 py-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <h4 className="text-base font-medium">{w.entity.name}</h4>
                  <EdgeCode qloo={w.qloo} />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm leading-6 text-paper/85">{w.notes.look}</p>
                  <Why label="Why this brand" name={w.entity.name} qloo={w.qloo} read={[{ term: "The look", text: w.notes.look }]} writtenBy={t.writtenBy} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {t.extras.brands.length > 0 && (
          <p className="mt-6 text-sm text-dim">
            Also high for this audience: <span className="font-mono text-xs text-tungsten">{names(t.extras.brands)}</span>
          </p>
        )}
      </Section>

      <Section
        id="locations"
        title={`Locations in ${t.brief.city}`}
        note="Real places whose regulars share this audience's taste, found by Qloo. Confirm availability and filming permission with each venue."
      >
        {t.locations.length === 0 ? (
          <p className="text-sm text-dim">No locations came back for {t.brief.city}. Check the city name, or try a nearby one.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {t.locations.map((l) => {
              const place = l.entity.place;
              const where = [place?.neighborhood, place?.price_level ? `price level ${place.price_level} of 4` : undefined].filter(Boolean).join(", ");
              const map =
                place?.lat !== undefined && place?.lon !== undefined
                  ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`
                  : undefined;
              return (
                <li key={l.entity.id} className="flex flex-col gap-2">
                  <Still src={l.entity.image} alt={`Photo of ${l.entity.name}`} className="aspect-[3/2] w-full rounded-sm" />
                  <h4 className="mt-1 text-base font-medium leading-snug">{l.entity.name}</h4>
                  {where && <p className="text-xs text-dim">{where}</p>}
                  <EdgeCode qloo={l.qloo} />
                  <p className="text-sm leading-6 text-paper/85">{l.notes.scene}</p>
                  <div className="flex items-center gap-4">
                    <Why label="Why this place" name={l.entity.name} qloo={l.qloo} read={[{ term: "The scene", text: l.notes.scene }]} writtenBy={t.writtenBy} />
                    {map && (
                      <a href={map} target="_blank" rel="noreferrer" className="text-xs text-dim underline decoration-line underline-offset-4 hover:text-paper">
                        Map<span className="sr-only"> of {l.entity.name} (opens in a new tab)</span>
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {t.extras.locations.length > 0 && (
          <p className="mt-8 text-sm text-dim">
            More to scout: <span className="font-mono text-xs text-tungsten">{names(t.extras.locations)}</span>
          </p>
        )}
      </Section>

      <div className="grid gap-10 md:grid-cols-3">
        <section aria-labelledby="lighting">
          <h3 id="lighting" className="text-xl font-semibold tracking-tight">
            Lighting
          </h3>
          <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm leading-6 text-paper/85 marker:text-line">
            {t.lighting.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="shots">
          <h3 id="shots" className="text-xl font-semibold tracking-tight">
            Shots
          </h3>
          <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm leading-6 text-paper/85 marker:text-line">
            {t.shots.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="palette">
          <h3 id="palette" className="text-xl font-semibold tracking-tight">
            Palette
          </h3>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {t.palette.map((c) => (
              <li key={c.hex} className="flex items-center gap-3">
                <span aria-hidden className="size-9 shrink-0 rounded-sm ring-1 ring-white/10" style={{ background: c.hex }} />
                <span className="min-w-0">
                  <span className="block text-sm leading-tight">{c.name}</span>
                  <span className="block text-xs tabular-nums text-dim">{c.hex}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="evidence" className="flex flex-col gap-5 rounded-lg border border-line p-5 sm:p-6">
        <div>
          <h3 id="evidence" className="text-xl font-semibold tracking-tight">
            What Qloo says about this audience
          </h3>
          <p className="mt-1 text-sm text-dim">Aggregate affinities from Qloo&apos;s taste graph, never facts about any one person.</p>
        </div>
        {t.audience.overlap.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm text-paper">Shared by your films and the audience</h4>
            <TagList tags={t.audience.overlap} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm text-paper">The audience over-indexes on</h4>
          {t.audience.taste_tags.length > 0 ? <TagList tags={t.audience.taste_tags} /> : <p className="text-sm text-dim">No taste tags came back.</p>}
        </div>
        {t.audience.leans.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm text-paper">Who over-indexes</h4>
            <p className="font-mono text-xs leading-5 text-tungsten">{t.audience.leans.join("; ")}</p>
          </div>
        )}
      </section>

      <footer className="flex flex-col gap-3 border-t border-line pt-6 text-sm text-dim">
        <h3 className="text-base font-medium text-paper">How this was made</h3>
        <p>
          {t.qloo.calls} Qloo {t.qloo.mode === "mock" ? "mock " : ""}requests, then{" "}
          {t.llm.map((l) => `${STEP_NAME[l.step].toLowerCase()} by ${modelName(l.producedBy)}`).join(", ")}.
        </p>
        <p>
          <span className="text-paper/80">Creative direction:</span> {t.direction}
        </p>
        {t.notes.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-line">
            {t.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
        {t.mock.qloo && (
          <p className="text-tape">Mock data: the names are real, but every score, tag, photo and ranking here is synthetic, not Qloo&apos;s.</p>
        )}
        {t.mock.llm && <p className="text-tape">Mock LLM: a deterministic template planned and wrote this, not a language model.</p>}
      </footer>
    </article>
  );
}

export interface Example<F> {
  label: string;
  form: F;
}

export function EmptyBoard<F>({
  examples,
  onTry,
  running,
  current,
}: {
  examples: Example<F>[];
  onTry: (form: F) => void;
  running: boolean;
  current?: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex min-h-[22rem] flex-col justify-end rounded-sm bg-graphite/40 p-6 ring-1 ring-line sm:aspect-[2.39/1] sm:min-h-0 sm:p-10">
        {running ? (
          <p className="text-2xl font-semibold tracking-tight text-paper/80">{current ?? "Starting"}…</p>
        ) : (
          <>
            <h2 className="max-w-3xl text-[clamp(2.25rem,5.5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.03em] text-balance">
              Your voice, their taste.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-pretty text-dim">
              Give Mise an artist, a shoot city and a budget. It reads what that audience loves on Qloo, then drafts a
              treatment: reference films, wardrobe, real locations, and the evidence behind every pick.
            </p>
          </>
        )}
      </div>
      {!running && (
        <div>
          <h3 className="text-sm text-dim">Try a brief</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {examples.map((example) => (
              <li key={example.label}>
                <button
                  type="button"
                  onClick={() => onTry(example.form)}
                  className="rounded-full px-3 py-1.5 text-sm text-paper ring-1 ring-line hover:ring-dim"
                >
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
