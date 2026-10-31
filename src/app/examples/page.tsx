import type { Metadata } from "next";
import { showData } from "../home/data";
import { SmoothScroll } from "../smooth";
import { SiteHeader } from "../studio/site-header";
import { ExampleGrid } from "./example-grid";

export const metadata: Metadata = {
  title: "Examples: itsgiving",
  description: "Finished treatments for music videos and short films, each built live from Qloo's taste data.",
};

/**
 * The featured treatments as cards, each opening its board through the camera's window. Static, like the homepage: the
 * featured set is read once, at build.
 */
export default function Examples() {
  const { live, frames, writer } = showData();
  return (
    <>
      <SiteHeader current="examples" />
      <SmoothScroll />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col px-4 pt-9 pb-14 sm:px-8 sm:pt-18 sm:pb-24">
        <header className="mb-7 flex flex-col gap-3.5 sm:mb-11">
          <h1 className="type-head text-display leading-[0.95] tracking-[-0.045em]">examples</h1>
          <p className="max-w-[52ch] text-lead leading-normal text-dim">
            {frames.length > 0
              ? `Finished treatments, each built live from Qloo's data and written by ${writer ?? "the model"}. Open one to read it from concept to credits.`
              : live
                ? "Featured treatments are built from live Qloo data when the site is deployed, and this deploy hasn't built them yet. The studio still builds treatments."
                : "Featured treatments are built from live Qloo data when the site is deployed with its keys, and this server has none. The studio still builds treatments."}
          </p>
        </header>
        <ExampleGrid frames={frames} />
      </main>
    </>
  );
}
