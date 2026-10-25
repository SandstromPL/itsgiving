import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Cooldowns,
  DailyBudget,
  LlmError,
  createProviders,
  deepseekProvider,
  extractJson,
  generateJson,
  geminiProvider,
  groqProvider,
  llmConfigFromEnv,
  strictModeViolations,
  toJsonSchema,
  type LlmCall,
  type LlmDeps,
  type LlmProvider,
} from ".";

const schema = z.strictObject({ title: z.string().min(1), tone: z.enum(["T1", "T2"]) });
const MOCK = { title: "Mock title", tone: "T1" as const };

function scripted(kind: "gemini" | "groq", model: string, replies: (string | LlmError)[]) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    kind,
    model,
    async complete(call) {
      prompts.push(call.prompt);
      const next = replies.shift();
      if (next === undefined) throw new Error("no scripted reply left");
      if (next instanceof LlmError) throw next;
      return { text: next };
    },
  };
  return { provider, prompts };
}

const rateLimited = (kind: "gemini" | "groq", model: string) =>
  new LlmError({ kind: "rate_limit", message: "429", provider: kind, model, status: 429 });

function deps(providers: LlmProvider[], overrides: Partial<LlmDeps> = {}): LlmDeps {
  return { mode: "live", providers, budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns(), ...overrides };
}

const ask = (d: LlmDeps, signal?: AbortSignal) =>
  generateJson({ name: "test", system: "sys", prompt: "brief", schema, mock: () => MOCK, signal }, d);

describe("generateJson", () => {
  it("normalizes a reply before validating it, so a harmless slip costs no repair call", async () => {
    const notes = z.strictObject({ notes: z.array(z.string()).min(1) });
    const reply = scripted("gemini", "m", ['{"notes":[{"setup":"One tungsten fresnel","why":"warm skin"}]}']);
    const flatten = (v: unknown) => {
      const value = v as { notes: unknown[] };
      return { notes: value.notes.map((n) => (typeof n === "object" && n ? Object.values(n).join(", ") : n)) };
    };
    const result = await generateJson(
      { name: "notes", system: "s", prompt: "p", schema: notes, mock: () => ({ notes: ["x"] }), normalize: flatten },
      deps([reply.provider]),
    );
    expect(result.data).toEqual({ notes: ["One tungsten fresnel, warm skin"] });
    expect(result.calls).toBe(1);
    expect(result.attempts[0].outcome).toBe("ok");
  });

  it("credits the thinking depth only to a provider that honours it", async () => {
    const thinker = { ...scripted("gemini", "thinker", ['{"title":"A","tone":"T1"}']).provider, thinks: true };
    const plain = scripted("gemini", "plain", ['{"title":"A","tone":"T1"}']).provider;
    const ask = (p: LlmProvider) =>
      generateJson({ name: "t", system: "s", prompt: "p", schema, mock: () => MOCK, reasoning: "high" }, deps([p]));
    expect((await ask(thinker)).producedBy).toEqual({ provider: "gemini", model: "thinker", mock: false, reasoning: "high" });
    expect((await ask(plain)).producedBy).toEqual({ provider: "gemini", model: "plain", mock: false });
  });

  it("returns the first valid output and names the model", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", ['{"title":"Neon Monsoon","tone":"T2"}']);
    const result = await ask(deps([gemini.provider]));
    expect(result.data).toEqual({ title: "Neon Monsoon", tone: "T2" });
    expect(result.producedBy).toEqual({ provider: "gemini", model: "gemini-3.8-flash", mock: false });
    expect(result.calls).toBe(1);
    expect(result.degraded).toBe(false);
  });

  it("repairs invalid output once on the same provider, with the validation problem in the prompt", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", ['```json\n{"title":"X","tone":"T9"}\n```', '{"title":"X","tone":"T1"}']);
    const result = await ask(deps([gemini.provider]));
    expect(result.data.tone).toBe("T1");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["repaired"]);
    expect(gemini.prompts[1]).toContain("REJECTED");
    expect(gemini.prompts[1]).toContain("tone");
    expect(result.calls).toBe(2);
  });

  it("falls through on 429 and on output that stays invalid after repair", async () => {
    const primary = scripted("gemini", "gemini-3.8-flash", [rateLimited("gemini", "gemini-3.8-flash")]);
    const lite = scripted("gemini", "gemini-3.5-flash-lite", ["not json", '{"title":""}']);
    const groq = scripted("groq", "openai/gpt-oss-120b", ['{"title":"Groq wrote this","tone":"T1"}']);
    const result = await ask(deps([primary.provider, lite.provider, groq.provider]));
    expect(result.producedBy.model).toBe("openai/gpt-oss-120b");
    expect(result.attempts.map((a) => [a.model, a.outcome, a.kind])).toEqual([
      ["gemini-3.8-flash", "error", "rate_limit"],
      ["gemini-3.5-flash-lite", "invalid", "invalid_output"],
      ["openai/gpt-oss-120b", "ok", undefined],
    ]);
    expect(result.attempts[1].message).toMatch(/^First reply: Not valid JSON[\s\S]* Repair: [\s\S]*title/);
  });

  it("degrades to the labelled mock when every live provider fails", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", [
      new LlmError({ kind: "upstream", message: "503", provider: "gemini", model: "gemini-3.8-flash", status: 503 }),
    ]);
    const result = await ask(deps([gemini.provider]));
    expect(result.data).toEqual(MOCK);
    expect(result.producedBy.mock).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it("uses only the mock in mock mode, without spending budget", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", []);
    const budget = new DailyBudget(5);
    const result = await ask(deps([gemini.provider], { mode: "mock", budget }));
    expect(result.producedBy).toEqual({ provider: "mock", model: "mise-template", mock: true });
    expect(result.degraded).toBe(false);
    expect(budget.remaining()).toBe(5);
    expect(gemini.prompts).toHaveLength(0);
  });

  it("stops calling real providers once the daily cap is spent", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", ['{"title":"A","tone":"T1"}']);
    const budget = new DailyBudget(1);
    expect((await ask(deps([gemini.provider], { budget }))).producedBy.mock).toBe(false);
    const blocked = await ask(deps([gemini.provider], { budget }));
    expect(blocked.producedBy.mock).toBe(true);
    expect(blocked.attempts[0]).toMatchObject({ outcome: "skipped", kind: "daily_cap" });
    expect(gemini.prompts).toHaveLength(1);
  });

  it("times out a slow provider and moves on", async () => {
    const slow: LlmProvider = {
      kind: "gemini",
      model: "slow",
      complete: (call) => new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason))),
    };
    const result = await ask(deps([slow], { timeoutMs: 20 }));
    expect(result.attempts[0]).toMatchObject({ model: "slow", outcome: "error", kind: "timeout" });
    expect(result.producedBy.mock).toBe(true);
  });

  it("rests a provider after it is overloaded, so the next call skips straight past it", async () => {
    const overloaded = new LlmError({ kind: "upstream", message: "503", provider: "gemini", model: "gemini-3.8-flash", status: 503 });
    const primary = scripted("gemini", "gemini-3.8-flash", [overloaded]);
    const backup = scripted("groq", "openai/gpt-oss-120b", ['{"title":"A","tone":"T1"}', '{"title":"B","tone":"T2"}']);
    const d = deps([primary.provider, backup.provider]);
    await ask(d);
    const second = await ask(d);
    expect(second.data.title).toBe("B");
    expect(second.attempts[0]).toMatchObject({ model: "gemini-3.8-flash", outcome: "skipped", kind: "cooldown" });
    expect(primary.prompts).toHaveLength(1);
  });

  it("honours a provider's retry delay when it is longer than the default rest", () => {
    let now = 0;
    const cooldowns = new Cooldowns(() => now);
    const provider = scripted("groq", "m", []).provider;
    cooldowns.trip(provider, 90_000);
    now = 89_000;
    expect(cooldowns.active(provider)).toBe(true);
    now = 90_001;
    expect(cooldowns.active(provider)).toBe(false);
  });

  it("skips real providers when the step's deadline is too close, and bounds each call by it", async () => {
    const gemini = scripted("gemini", "gemini-3.8-flash", ['{"title":"A","tone":"T1"}']);
    const late = await generateJson(
      { name: "test", system: "", prompt: "", schema, mock: () => MOCK, deadline: Date.now() + 500 },
      deps([gemini.provider]),
    );
    expect(late.producedBy.mock).toBe(true);
    expect(late.attempts[0]).toMatchObject({ outcome: "skipped", kind: "deadline" });
    expect(gemini.prompts).toHaveLength(0);

    let seenTimeout = 0;
    const slow: LlmProvider = {
      kind: "gemini",
      model: "slow",
      complete: (call) =>
        new Promise((_, reject) => {
          const t0 = Date.now();
          call.signal.addEventListener("abort", () => {
            seenTimeout = Date.now() - t0;
            reject(call.signal.reason);
          });
        }),
    };
    const cooldowns = new Cooldowns();
    const bounded = await generateJson(
      { name: "test", system: "", prompt: "", schema, mock: () => MOCK, deadline: Date.now() + 3_300 },
      deps([slow], { timeoutMs: 60_000, cooldowns }),
    );
    // Cut short by the run's deadline, not by the provider: recorded as out of time, and not rested.
    expect(bounded.attempts[0]).toMatchObject({ outcome: "error", kind: "deadline" });
    expect(seenTimeout).toBeLessThan(4_000);
    expect(cooldowns.active(slow)).toBe(false);
  });

  it("lets a step set its own call timeout", async () => {
    let seen = 0;
    const slow: LlmProvider = {
      kind: "deepseek",
      model: "slow-writer",
      complete: (call) =>
        new Promise((_, reject) => {
          const t0 = Date.now();
          call.signal.addEventListener("abort", () => {
            seen = Date.now() - t0;
            reject(call.signal.reason);
          });
        }),
    };
    const result = await generateJson(
      { name: "test", system: "", prompt: "", schema, mock: () => MOCK, timeoutMs: 50 },
      deps([slow], { timeoutMs: 60_000 }),
    );
    expect(result.attempts[0]).toMatchObject({ outcome: "error", kind: "timeout" });
    expect(seen).toBeLessThan(1_000);
  });

  it("propagates a client abort instead of falling through", async () => {
    const controller = new AbortController();
    const hanging: LlmProvider = {
      kind: "groq",
      model: "hang",
      complete: (call) =>
        new Promise((_, reject) => {
          call.signal.addEventListener("abort", () => reject(new Error("aborted")));
          controller.abort();
        }),
    };
    await expect(ask(deps([hanging]), controller.signal)).rejects.toMatchObject({ kind: "aborted" });
  });

  it("rejects a mock that breaks its own schema (a programming error)", async () => {
    await expect(
      generateJson(
        { name: "bad", system: "", prompt: "", schema, mock: () => ({ title: "", tone: "T3" }) as never },
        deps([], { mode: "mock" }),
      ),
    ).rejects.toThrow(/does not match its schema/);
  });
});

describe("extractJson", () => {
  it("reads fenced or prose-wrapped JSON", () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` hope that helps')).toEqual({ a: 1 });
    expect(() => extractJson("no braces")).toThrow();
  });
});

describe("llmConfigFromEnv", () => {
  it("runs the mock with no keys and live with any key", () => {
    expect(llmConfigFromEnv({}).mode).toBe("mock");
    expect(llmConfigFromEnv({ GROQ_API_KEY: "g" }).mode).toBe("live");
    expect(llmConfigFromEnv({ GEMINI_API_KEY: "k", LLM_MODE: "mock" }).mode).toBe("mock");
  });

  it("puts paid DeepSeek first, then the free Flash-Lite and Groq, with 3.8 Flash as the last resort", () => {
    const config = llmConfigFromEnv({ GEMINI_API_KEY: "k", GROQ_API_KEY: "g", DEEPSEEK_API_KEY: "d" });
    expect(createProviders(config).map((p) => `${p.kind}:${p.model}`)).toEqual([
      "deepseek:deepseek-flash",
      "gemini:gemini-3.5-flash-lite",
      "groq:openai/gpt-oss-120b",
      "gemini:gemini-3.8-flash",
    ]);
    // Without the paid key the chain is free-only, Flash-Lite first.
    expect(createProviders(llmConfigFromEnv({ GEMINI_API_KEY: "k", GROQ_API_KEY: "g" }))[0].model).toBe("gemini-3.5-flash-lite");
    expect(llmConfigFromEnv({ DEEPSEEK_API_KEY: "d" }).mode).toBe("live");
  });

  it("honours model overrides, drops 'none', and skips providers without a key", () => {
    const overridden = llmConfigFromEnv({
      GEMINI_API_KEY: "k",
      GROQ_API_KEY: "g",
      GEMINI_MODEL: "gemini-x",
      GEMINI_FALLBACK_MODEL: "none",
    });
    expect(createProviders(overridden).map((p) => `${p.kind}:${p.model}`)).toEqual(["gemini:gemini-x", "groq:openai/gpt-oss-120b"]);
    expect(createProviders(llmConfigFromEnv({ GROQ_API_KEY: "g" })).map((p) => p.kind)).toEqual(["groq"]);
    const same = llmConfigFromEnv({ GEMINI_API_KEY: "k", GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite" });
    expect(createProviders(same).map((p) => p.model)).toEqual(["gemini-3.5-flash-lite"]);
  });
});

describe("DailyBudget", () => {
  it("resets at the UTC day boundary", () => {
    let now = new Date("2026-10-24T23:59:00Z");
    const budget = new DailyBudget(1, () => now);
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
    now = new Date("2026-10-25T00:00:01Z");
    expect(budget.take()).toBe(true);
  });
});

function recordingFetch(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, requests };
}

const call = (overrides: Partial<LlmCall> = {}): LlmCall => ({
  system: "You plan.",
  prompt: "Brief here.",
  schema: toJsonSchema(
    z.strictObject({
      tone: z
        .array(z.enum(["T1"]))
        .min(1)
        .max(3),
      hex: z.string().regex(/^#/),
    }),
  ),
  schemaName: "plan",
  maxOutputTokens: 2048,
  effort: "low",
  signal: new AbortController().signal,
  mock: () => ({}),
  ...overrides,
});

describe("geminiProvider", () => {
  it("sends generateContent with responseJsonSchema and thinkingLevel, and skips thought parts", async () => {
    const { fetchImpl, requests } = recordingFetch(200, {
      candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: '{"tone":["T1"]}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
    });
    const provider = geminiProvider({ apiKey: "secret", model: "gemini-3.8-flash", fetch: fetchImpl });
    const result = await provider.complete(call());
    expect(result.text).toBe('{"tone":["T1"]}');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, thinkingTokens: 7 });

    const { url, init } = requests[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain("secret");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret");
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You plan." }] });
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "low" },
    });
    const sent = body.generationConfig.responseJsonSchema;
    expect(sent.properties.tone).toMatchObject({ type: "array", minItems: 1, maxItems: 3 });
    expect(sent.properties.hex).not.toHaveProperty("pattern");
  });

  it.each([
    [429, "rate_limit"],
    [503, "upstream"],
    [400, "bad_request"],
    [403, "auth"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const { fetchImpl } = recordingFetch(status, { error: { message: "nope" } });
    const provider = geminiProvider({ apiKey: "k", model: "m", fetch: fetchImpl });
    await expect(provider.complete(call())).rejects.toMatchObject({ kind, status });
  });

  it("reads Gemini's RetryInfo delay from a 429", async () => {
    const { fetchImpl } = recordingFetch(429, {
      error: { message: "quota", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" }] },
    });
    await expect(geminiProvider({ apiKey: "k", model: "m", fetch: fetchImpl }).complete(call())).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 33_000,
    });
  });

  it("treats MAX_TOKENS and safety stops as failures", async () => {
    for (const [finishReason, kind] of [
      ["MAX_TOKENS", "truncated"],
      ["SAFETY", "blocked"],
    ]) {
      const { fetchImpl } = recordingFetch(200, { candidates: [{ content: { parts: [{ text: "{" }] }, finishReason }] });
      const provider = geminiProvider({ apiKey: "k", model: "m", fetch: fetchImpl });
      await expect(provider.complete(call())).rejects.toMatchObject({ kind });
    }
  });

  it("ignores the call's reasoning depth (more thinking didn't help the free tier)", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] });
    await geminiProvider({ apiKey: "k", model: "m", fetch: fetchImpl }).complete(call({ reasoning: "high" }));
    expect(JSON.parse(String(requests[0].init.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("lets thinkingLevel override the step's effort", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }] });
    await geminiProvider({ apiKey: "k", model: "m", fetch: fetchImpl, thinkingLevel: "high" }).complete(call());
    expect(JSON.parse(String(requests[0].init.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });
});

describe("groqProvider", () => {
  it("sends strict json_schema with low reasoning effort and no reasoning text", async () => {
    const { fetchImpl, requests } = recordingFetch(200, {
      choices: [{ message: { content: '{"tone":["T1"]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
    const provider = groqProvider({ apiKey: "gsk", model: "openai/gpt-oss-120b", fetch: fetchImpl });
    expect((await provider.complete(call())).text).toBe('{"tone":["T1"]}');
    const { url, init } = requests[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gsk");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 2048,
      response_format: { type: "json_schema", json_schema: { name: "plan", strict: true } },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.response_format.json_schema.schema.properties.tone).not.toHaveProperty("maxItems");
  });

  it("maps 413 (tokens-per-minute) to rate_limit and a schema miss to invalid_output", async () => {
    const tpm = recordingFetch(413, { error: { message: "Request too large" } });
    await expect(groqProvider({ apiKey: "k", model: "m", fetch: tpm.fetchImpl }).complete(call())).rejects.toMatchObject({
      kind: "rate_limit",
    });
    const miss = recordingFetch(400, { error: { message: "Generated JSON does not match the expected schema." } });
    await expect(groqProvider({ apiKey: "k", model: "m", fetch: miss.fetchImpl }).complete(call())).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });

  it("stays at low effort whatever depth the call asks for", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    await groqProvider({ apiKey: "k", model: "m", fetch: fetchImpl }).complete(call({ reasoning: "high" }));
    expect(JSON.parse(String(requests[0].init.body)).reasoning_effort).toBe("low");
  });

  it("sends a higher reasoning effort when asked", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    await groqProvider({ apiKey: "k", model: "m", fetch: fetchImpl, reasoningEffort: "high" }).complete(call());
    expect(JSON.parse(String(requests[0].init.body)).reasoning_effort).toBe("high");
  });
});

describe("deepseekProvider", () => {
  it("sends json_object mode with thinking off and the schema in the prompt", async () => {
    const { fetchImpl, requests } = recordingFetch(200, {
      choices: [{ message: { content: '{"tone":["T1"]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 30, completion_tokens: 6 },
    });
    const provider = deepseekProvider({ apiKey: "sk-test", model: "deepseek-flash", fetch: fetchImpl });
    expect((await provider.complete(call())).text).toBe('{"tone":["T1"]}');
    const { url, init } = requests[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "deepseek-flash",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: 2048,
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    // DeepSeek requires the word "json" and an example of the shape in the prompt.
    expect(body.messages[1].content).toContain("json object");
    expect(body.messages[1].content).toContain('"tone"');
  });

  it("rests on 402 (out of credit) and fails on empty JSON-mode content", async () => {
    const broke = recordingFetch(402, { error: { message: "Insufficient Balance" } });
    await expect(deepseekProvider({ apiKey: "k", model: "m", fetch: broke.fetchImpl }).complete(call())).rejects.toMatchObject({
      kind: "rate_limit",
      status: 402,
    });
    const empty = recordingFetch(200, { choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    await expect(deepseekProvider({ apiKey: "k", model: "m", fetch: empty.fetchImpl }).complete(call())).rejects.toMatchObject({
      kind: "empty",
    });
  });

  it("thinks at the call's depth, with room for the reasoning on top of the answer's tokens", async () => {
    const { fetchImpl, requests } = recordingFetch(200, { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    const provider = deepseekProvider({ apiKey: "k", model: "m", fetch: fetchImpl });
    await provider.complete(call({ reasoning: "high" }));
    await provider.complete(call({ reasoning: "low" }));
    const [deep, quick] = requests.map((r) => JSON.parse(String(r.init.body)));
    expect(deep).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high", max_tokens: 2048 + 8192 });
    expect(quick).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low", max_tokens: 2048 + 4096 });
  });
});

describe("strictModeViolations", () => {
  it("flags optional properties and open objects", () => {
    const loose = toJsonSchema(z.object({ a: z.string().optional() }));
    expect(strictModeViolations(loose)).toEqual(["$: additionalProperties must be false", "$.a: must be required"]);
    expect(strictModeViolations(toJsonSchema(schema))).toEqual([]);
  });
});
