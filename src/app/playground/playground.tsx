"use client";

import { useState } from "react";
import type { ToolResult } from "@/lib/tools/types";

export interface ToolInfo {
  name: string;
  description: string;
  example: string;
}

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-foreground text-background",
  empty: "bg-track text-dim",
  needs_input: "border border-dashed border-edge text-foreground",
  error: "bg-safelight-wash text-safelight",
};

export function Playground({ tools }: { tools: ToolInfo[] }) {
  const [name, setName] = useState(tools[0]?.name ?? "");
  const [input, setInput] = useState(tools[0]?.example ?? "{}");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const tool = tools.find((t) => t.name === name);

  function select(next: string) {
    setName(next);
    setInput(tools.find((t) => t.name === next)?.example ?? "{}");
    setResult(null);
    setError(null);
  }

  async function run() {
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(input);
    } catch {
      setError("Input is not valid JSON.");
      return;
    }
    setRunning(true);
    try {
      const response = await fetch(`/api/tools/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as ToolResult | { error: string };
      if ("tool" in json) setResult(json);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => select(t.name)}
              className={`rounded-full border px-3 py-1 font-mono text-label leading-4 transition ${
                t.name === name ? "border-foreground bg-foreground text-background" : "border-line text-dim hover:border-edge"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <p className="text-small leading-6 text-dim">{tool?.description}</p>
        <textarea
          aria-label="Tool input (JSON)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full resize-y rounded-lg border border-line bg-field p-3 font-mono text-label leading-4 text-foreground outline-none focus:border-edge"
        />
        <button
          onClick={run}
          disabled={running}
          className="self-start rounded-lg bg-foreground px-4 py-2 text-small leading-5 font-medium text-background transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Running…" : "Run tool"}
        </button>
        {error && <p className="text-small leading-5 text-safelight">{error}</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {!result && <p className="text-small leading-5 text-faint">Run a tool to see its result and the Qloo requests behind it.</p>}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded px-2 py-0.5 font-mono text-label leading-4 ${STATUS_STYLES[result.status] ?? ""}`}>
                {result.status}
              </span>
              <span className="font-mono text-label leading-4 text-faint">{result.mode} data</span>
            </div>
            <p className="text-small leading-6 text-foreground">{result.summary}</p>
            {result.error?.hint && <p className="text-small leading-5 text-foreground">Hint: {result.error.hint}</p>}
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-label leading-5 text-dim">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <section>
              <h3 className="mb-2 font-mono text-label leading-4 text-faint">Qloo requests ({result.provenance.length})</h3>
              <ul className="flex flex-col gap-1">
                {result.provenance.map((p, i) => (
                  <li key={i} className="overflow-x-auto whitespace-nowrap rounded bg-field px-2 py-1 font-mono text-label text-dim">
                    <span className="text-foreground">GET {p.path}</span> {new URLSearchParams(p.query).toString()}{" "}
                    <span className="text-faint">
                      → {p.status} · {p.cached ? "cached" : `${p.durationMs}ms`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-field p-3 font-mono text-label leading-5 text-dim">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
