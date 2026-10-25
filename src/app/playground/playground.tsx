"use client";

import { useState } from "react";
import type { ToolResult } from "@/lib/tools/types";

export interface ToolInfo {
  name: string;
  description: string;
  example: string;
}

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300",
  empty: "bg-stone-500/20 text-stone-300",
  needs_input: "bg-amber-500/15 text-amber-300",
  error: "bg-rose-500/15 text-rose-300",
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
              className={`rounded-full border px-3 py-1 font-mono text-xs transition ${
                t.name === name ? "border-amber-300 bg-amber-300 text-stone-950" : "border-stone-700 text-stone-300 hover:border-stone-500"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <p className="text-sm leading-6 text-stone-400">{tool?.description}</p>
        <textarea
          aria-label="Tool input (JSON)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full resize-y rounded-lg border border-stone-800 bg-stone-900 p-3 font-mono text-xs text-stone-200 outline-none focus:border-stone-600"
        />
        <button
          onClick={run}
          disabled={running}
          className="self-start rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-950 transition hover:bg-white disabled:opacity-50"
        >
          {running ? "Running…" : "Run tool"}
        </button>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {!result && <p className="text-sm text-stone-500">Run a tool to see its result and the Qloo requests behind it.</p>}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded px-2 py-0.5 font-mono text-xs ${STATUS_STYLES[result.status] ?? ""}`}>{result.status}</span>
              <span className="font-mono text-xs uppercase tracking-wider text-stone-500">{result.mode} data</span>
            </div>
            <p className="text-sm leading-6 text-stone-200">{result.summary}</p>
            {result.error?.hint && <p className="text-sm text-amber-300">Hint: {result.error.hint}</p>}
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-xs leading-5 text-amber-300/90">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <section>
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-stone-500">Qloo requests ({result.provenance.length})</h3>
              <ul className="flex flex-col gap-1">
                {result.provenance.map((p, i) => (
                  <li
                    key={i}
                    className="overflow-x-auto whitespace-nowrap rounded bg-stone-900 px-2 py-1 font-mono text-[11px] text-stone-400"
                  >
                    <span className="text-stone-200">GET {p.path}</span> {new URLSearchParams(p.query).toString()}{" "}
                    <span className="text-stone-500">
                      → {p.status} · {p.cached ? "cached" : `${p.durationMs}ms`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <pre className="max-h-[32rem] overflow-auto rounded-lg border border-stone-800 bg-stone-900 p-3 font-mono text-[11px] leading-5 text-stone-300">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
