import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toolPlaygroundEnabled } from "@/lib/env";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { TOOLS } from "@/lib/tools/registry";
import { Playground, type ToolInfo } from "./playground";

export const metadata: Metadata = { title: "Tool playground · itsgiving", robots: { index: false } };

/** Developer playground for the agent's Qloo tools; 404 in production unless ITSGIVING_TOOL_PLAYGROUND=1. */
export default function PlaygroundPage() {
  if (!toolPlaygroundEnabled()) notFound();
  const mode = qlooConfigFromEnv().mode;
  const tools: ToolInfo[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    example: JSON.stringify(tool.example, null, 2),
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-12 sm:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-subhead leading-8 font-semibold tracking-tight text-foreground">Tool playground</h1>
          <span
            className={`rounded px-2 py-0.5 text-label leading-4 font-medium ${
              mode === "live" ? "border border-line text-dim" : "bg-tape-wash text-tape"
            }`}
          >
            {mode === "live" ? "Live Qloo" : "Mock data"}
          </span>
        </div>
        <p className="max-w-2xl text-small leading-6 text-dim">
          Run each of the agent&apos;s Qloo tools by hand and see the requests behind the result. Development only.{" "}
          <Link
            href="/studio"
            className="font-semibold text-foreground underline decoration-line underline-offset-4 hover:decoration-foreground"
          >
            Back to the treatment builder
          </Link>
        </p>
      </header>
      <Playground tools={tools} />
    </main>
  );
}
