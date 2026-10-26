import { Suspense } from "react";
import { featuredCovers, featuredReplay, loadFeatured } from "@/lib/agent/featured";
import { llmConfigFromEnv } from "@/lib/llm/config";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { LiveModes } from "./studio/live-modes";
import { ModesPending } from "./studio/parts";
import { Studio } from "./studio/studio";

export default function Home() {
  // Featured treatments are live data, so a server running on mocks doesn't offer them: their covers
  // would promise what a mock run can't deliver. Read at build time, they become part of the static shell,
  // as does the one replayed under "Watch it work".
  const live = qlooConfigFromEnv().mode === "live" && llmConfigFromEnv().mode === "live";
  const items = live ? loadFeatured() : [];
  return (
    <Studio
      featured={featuredCovers(items)}
      replay={featuredReplay(items)}
      initialBadges={
        <Suspense fallback={<ModesPending />}>
          <LiveModes />
        </Suspense>
      }
    />
  );
}
