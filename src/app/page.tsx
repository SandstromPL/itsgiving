import { SmoothScroll } from "./smooth";
import { showData } from "./home/data";
import { Ending } from "./home/ending";
import { Flatbed, FlatbedEmpty } from "./home/flatbed";
import { HowItWorks, HowItWorksSteps } from "./home/how";
import { Opening } from "./home/opening";
import { Pitch } from "./home/pitch";
import { SiteHeader } from "./studio/site-header";

/**
 * The pitch, one block to a screen: the title card dollied through to the line, the pitch, the featured treatments on a
 * flatbed, one real run step by step, and the way in. It holds no form and reads nothing per request, so the whole page
 * is built once, featured treatments included. The header waits until "Watch it work".
 */
export default function Home() {
  const { live, frames, run } = showData();
  return (
    <>
      <SiteHeader home reveal={{ after: "how" }} />
      <SmoothScroll />
      <main className="flex flex-1 flex-col">
        <Opening />
        <Pitch />
        {frames.length > 0 ? <Flatbed frames={frames} /> : <FlatbedEmpty live={live} />}
        {run ? <HowItWorks run={run} still={frames.find((frame) => frame.slug === run.slug)?.still} /> : <HowItWorksSteps />}
        <Ending examples={frames.length > 0} />
      </main>
    </>
  );
}
