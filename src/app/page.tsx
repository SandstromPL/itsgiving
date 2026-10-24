import { toolPlaygroundEnabled } from "@/lib/env";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { TOOLS } from "@/lib/tools/registry";
import { Playground, type ToolInfo } from "./playground";

export default function Home() {
  const mode = qlooConfigFromEnv().mode;
  const tools: ToolInfo[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    example: JSON.stringify(tool.example, null, 2),
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-12 sm:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-3xl font-semibold tracking-[0.3em] text-stone-100">MISE</h1>
          <span
            className={`rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
              mode === "live" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {mode === "live" ? "Live Qloo" : "Mock data"}
          </span>
        </div>
        <p className="max-w-2xl text-lg leading-8 text-stone-300">
          Treatments with taste: an agent that turns an artist or a few reference films into a treatment grounded in what
          their audience actually loves, from reference films and wardrobe to real shoot locations.
        </p>
        <p className="max-w-2xl text-sm leading-6 text-stone-500">
          Work in progress. Below is the developer playground for the agent&apos;s Qloo tools; the treatment builder comes
          next.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-mono text-xs uppercase tracking-wider text-stone-500">Agent tools</h2>
        {toolPlaygroundEnabled() ? (
          <Playground tools={tools} />
        ) : (
          <p className="text-sm text-stone-400">The tool playground is disabled in this deployment.</p>
        )}
      </section>
    </main>
  );
}
