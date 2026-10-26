import type { Metadata } from "next";
import { accountsOn } from "@/lib/supabase/config";
import { StartYourOwn } from "../studio/landing";
import { SiteHeader } from "../studio/site-header";

// About: who itsgiving is for (first, as Paritosh asked), what it is, what Qloo is, and how one uses the other. Static,
// like the homepage. Qloo's facts come from research/qloo-company-and-judges.md, each dated there.

export const metadata: Metadata = {
  title: "About: itsgiving",
  description: "Who itsgiving is for, what Qloo is, and how itsgiving uses Qloo's taste graph to write treatments.",
};

const USERS = [
  {
    who: "Music-video directors",
    situation:
      "You're bidding for a video, often against two other directors, with a few days and no research budget. You know your own references. The artist's fans are the unknown.",
    gets: "A treatment built on what those fans love: the films, the clothes, the places, and the part of the city where they are.",
  },
  {
    who: "Short-film makers",
    situation:
      "You know the films your short is after. You need a lookbook that gets your cinematographer, production designer and costume on the same page, and convinces a festival, a grant or a crowdfunder.",
    gets: "A lookbook that reads the audience of those films and turns it into references, wardrobe and real places to scout.",
  },
  {
    who: "Labels, artist managers and producers",
    situation:
      "You brief directors and choose between their treatments. You need to know which one speaks to the artist's audience, not only to the director's taste.",
    gets: "Treatments where every film, brand and place shows Qloo's receipt: how it ranks with that audience, and what put it there.",
  },
] as const;

const MAKES = [
  "A title, a logline and a concept",
  "The tone, in the audience's own words",
  "Reference films, and what to borrow from each",
  "Beats, shots, light and a palette",
  "Wardrobe brands the fans favour",
  "Real locations around a shoot base, on a map",
] as const;

const QLOO = [
  {
    head: "Across culture.",
    text: "Music artists, films and TV, books, podcasts, brands, places and neighbourhoods: over 250 million entries, by the hackathon's count.",
  },
  {
    head: "Across domains.",
    text: "Its signature is cross-domain affinity. Start from the fans of one artist and it ranks the films, clothes and places they over-index on.",
  },
  {
    head: "Down to the street.",
    text: "It maps where an audience's taste is strongest in a city, tile by tile, so a shoot can be based where the fans are.",
  },
  {
    head: "Without identity.",
    text: "It learns from anonymized signals and needs no names, emails or device IDs. What it says describes groups, never a person.",
  },
] as const;

/** The run, in order. Qloo's steps show their calls on a receipt slip; the model's two steps speak in its serif. */
const STEPS: { title: string; text: string; qloo?: string[]; model?: string }[] = [
  {
    title: "Find the names in Qloo",
    text: "The artist, the films and the shoot city become Qloo entries. A name that could mean two titles is asked about, never guessed. Musicians Qloo files under people are found there, and an artist it doesn't have can be read through stand-in artists with a similar audience.",
    qloo: ["/search", "/entities"],
  },
  {
    title: "Read the audience",
    text: "What the fans over-index on, in Qloo's own words (moods, genres, styles), and the age and gender they lean to.",
    qloo: ["/v2/insights, taste tags", "/v2/insights, demographics"],
  },
  {
    title: "Compare with your taste",
    text: "Add the films you love and Qloo compares them with the audience. What you share becomes the spine of the treatment: your voice, their taste.",
    qloo: ["/v2/analysis/compare"],
  },
  {
    title: "Map where the fans are",
    text: "Qloo's heatmap scores the shoot city tile by tile for this audience, and itsgiving names the three strongest areas.",
    qloo: ["/v2/insights, heatmap", "/search, areas nearby"],
  },
  {
    title: "Plan the creative direction",
    text: "A model picks the direction: the tone from Qloo's tags, a few style words, and which area to base the shoot in. It can only choose what Qloo returned.",
    model: "The model chooses, from Qloo's list.",
  },
  {
    title: "Find references, wardrobe and places",
    text: "Films the audience over-indexes on, from the canon to deep cuts; fashion brands steered by the style words; and real places within 2 km of the base, inside the budget, with photos.",
    qloo: ["/v2/tags, style words", "/v2/insights, films", "/v2/insights, brands", "/v2/insights, places"],
  },
  {
    title: "Write the treatment",
    text: "The model writes the treatment and may cite only what Qloo returned. Every film, brand and place keeps its receipt: its rank for this audience, and its affinity.",
    model: "The model writes, citing only Qloo's picks.",
  },
];

const LIMITS = [
  "Qloo describes groups. A treatment says what an audience tends to love, never what one person will do.",
  "Qloo lists feature films and artists, not short films or songs. A short's audience comes from the feature films it's after, and a video's from the artist, not the track.",
  "Not every artist is in Qloo. When one is missing, stand-in artists carry the audience, and the treatment says so.",
  "Locations are a scout list. Availability and filming permission are yours to confirm with each venue.",
] as const;

const sectionHead = "type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none";
const lead = "max-w-[60ch] text-[1.2rem] leading-[1.55] text-dim";

export default function About() {
  return (
    <>
      <SiteHeader current="about" />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-24 px-4 pt-10 pb-20 sm:px-8 sm:pt-14">
        <section aria-labelledby="who-heading" className="flex flex-col gap-10">
          <div className="flex flex-col gap-6">
            <span className="self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">About itsgiving</span>
            <h1 id="who-heading" className="type-poster text-[clamp(3.5rem,7vw,6rem)]">
              who it&apos;s for
            </h1>
            <p className={lead}>
              itsgiving is for directors who make music videos and short films, and for the people who commission them. They share one
              problem: the work has to land with an audience the director has never met.
            </p>
          </div>
          <dl className="flex flex-col">
            {USERS.map((user) => (
              <div key={user.who} className="grid gap-x-12 gap-y-3 border-t border-line py-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <dt className="type-head text-[1.6rem] leading-tight">{user.who}</dt>
                <dd className="flex max-w-[62ch] flex-col gap-3 text-[1.1rem] leading-[1.55]">
                  <p className="text-dim">{user.situation}</p>
                  <p>{user.gets}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="what-heading" className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex flex-col gap-5">
            <h2 id="what-heading" className={sectionHead}>
              What it is
            </h2>
            <p className={lead}>
              A treatment agent. Give it an artist, or the films a short is after, and a shoot city. In about 40 seconds it writes a
              treatment you can pitch, built on what that audience loves.
            </p>
            <p className={lead}>
              Add the films you love and it finds where your taste meets theirs: your voice, their taste. Every treatment prints to PDF and
              takes a rework in one tap: darker, more 90s, deeper cuts, cheaper locations.
              {accountsOn
                ? " No account is needed to build one; sign in with Google or GitHub to save it and share it by link."
                : " No sign-up."}
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-[28px] border border-line bg-card p-6 sm:p-8">
            <p className="text-[15px] font-semibold text-dim">Each treatment holds</p>
            <ul className="flex flex-col">
              {MAKES.map((item) => (
                <li key={item} className="border-t border-line py-3 text-[1.1rem] leading-snug first:border-t-0">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="qloo-heading" className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
            <h2 id="qloo-heading" className={sectionHead}>
              What Qloo is
            </h2>
            <p className={lead}>
              Qloo is a taste graph: a map of how people&apos;s tastes connect across culture. It calls itself the privacy-first cultural
              intelligence layer for AI, and gives agents something a language model can&apos;t: what real audiences love, and where they
              are.
            </p>
          </div>
          <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {QLOO.map((point) => (
              <li key={point.head} className="border-t border-line pt-4 text-[1.1rem] leading-[1.55]">
                <span className="font-bold">{point.head}</span> <span className="text-dim">{point.text}</span>
              </li>
            ))}
          </ul>
          <p className="text-[15px] text-dim">
            More at{" "}
            <a href="https://www.qloo.com/" className="font-semibold text-foreground underline underline-offset-4">
              qloo.com
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="how-heading" className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
            <h2 id="how-heading" className={sectionHead}>
              How itsgiving uses Qloo
            </h2>
            <p className={lead}>
              Code makes every Qloo call. A model plans and writes, but only from what Qloo returned, so nothing in a treatment is invented.
              A treatment takes about 20 Qloo calls and two model calls.
            </p>
          </div>
          <ol className="flex flex-col">
            {STEPS.map((step, i) => (
              <li key={step.title} className="grid gap-x-12 gap-y-4 border-t border-line py-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="flex max-w-[62ch] flex-col gap-2">
                  <span className="text-[14px] font-semibold text-faint">Step {i + 1}</span>
                  <h3 className="type-head text-[1.5rem] leading-tight">{step.title}</h3>
                  <p className="text-[1.05rem] leading-[1.55] text-dim">{step.text}</p>
                </div>
                {step.qloo ? (
                  <div className="self-start rounded-xl border border-dashed border-slip-edge bg-slip px-4 py-3 font-mono text-[13px] leading-[1.7] text-[#2b2925]">
                    <p className="font-semibold">Qloo calls</p>
                    {step.qloo.map((call) => (
                      <p key={call}>{call}</p>
                    ))}
                  </div>
                ) : (
                  <p className="self-start font-serif text-[1.3rem] leading-snug italic">{step.model}</p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="limits-heading" className="flex flex-col gap-6">
          <h2 id="limits-heading" className={sectionHead}>
            What a treatment can&apos;t tell you
          </h2>
          <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {LIMITS.map((limit) => (
              <li key={limit} className="max-w-[56ch] border-t border-line pt-4 text-[1.05rem] leading-[1.55] text-dim">
                {limit}
              </li>
            ))}
          </ul>
        </section>

        {accountsOn && (
          <section aria-labelledby="account-heading" className="flex flex-col gap-5">
            <h2 id="account-heading" className={sectionHead}>
              Accounts and your data
            </h2>
            <p className={lead}>
              Building a treatment needs no account. Signing in with Google or GitHub is only for saving treatments and sharing them.
              itsgiving keeps your name and email from that sign-in and the treatments you save; none of it goes to Qloo or the AI models.
            </p>
            <p className={lead}>
              A saved treatment is private until you turn on its share link. Shared pages are never indexed and don&apos;t say whose they
              are, and deleting a treatment takes its link down with it.
            </p>
          </section>
        )}

        <StartYourOwn />
      </main>
    </>
  );
}
