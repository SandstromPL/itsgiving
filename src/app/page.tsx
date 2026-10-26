import { EXAMPLES } from "@/lib/agent/examples";
import { featuredCovers, featuredItem, featuredOffered, featuredRun, loadFeatured } from "@/lib/agent/featured";
import { Hero, HowItWorks, HowItWorksSteps, NowShowing, StartYourOwn } from "./studio/landing";
import { SiteHeader } from "./studio/site-header";
import { suggestTitleFont } from "./studio/title-fonts";

/**
 * The pitch: what itsgiving is, the featured treatments, one real run explained, and the way into the studio. It
 * holds no form and reads nothing per request, so the whole page is built once, featured treatments included. Only
 * featured treatments whose own page will open are offered (featuredItem).
 */
export default function Home() {
  const all = featuredOffered() ? loadFeatured() : [];
  const items = EXAMPLES.filter((example) => example.featured).flatMap((example) => featuredItem(example.slug, all) ?? []);
  const covers = featuredCovers(items);
  const run = featuredRun(items);
  const first = items[0];
  return (
    <>
      <SiteHeader home />
      <main className="flex flex-1 flex-col">
        <Hero cover={covers[0]} fontId={first && suggestTitleFont(first.treatment).id} />
        <NowShowing covers={covers.length > 1 ? covers.slice(1) : covers} />
        {run ? <HowItWorks run={run} /> : <HowItWorksSteps />}
        <div className="mx-auto w-full max-w-[80rem] px-4 pb-20 sm:px-8">
          <StartYourOwn />
        </div>
      </main>
    </>
  );
}
