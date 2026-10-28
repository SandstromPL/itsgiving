import { describe, expect, it } from "vitest";
import { failFor, postJson, type PostJson } from "./post";
import { LlmError } from "./types";

type Reply = { answer?: string; error?: { message?: string; code?: string } };

function answering(status: number, text: string, headers: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    sent.push({ url, init: init ?? {} });
    return new Response(text, { status, headers });
  };
  return { fetchImpl, sent };
}

const post = (fetchImpl: ReturnType<typeof answering>["fetchImpl"], extra: Partial<PostJson<Reply>> = {}) =>
  postJson<Reply>({
    url: "https://llm.example/v1/chat",
    headers: { authorization: "Bearer k" },
    body: { model: "m", n: 1 },
    signal: new AbortController().signal,
    fetch: fetchImpl,
    fail: failFor("Example", "groq", "model-x"),
    ...extra,
  });

describe("postJson", () => {
  it("POSTs the body as JSON with the key's header, and returns the parsed reply ({} when it's empty)", async () => {
    const ok = answering(200, '{"answer":"yes"}');
    expect(await post(ok.fetchImpl)).toEqual({ answer: "yes" });
    const { url, init } = ok.sent[0];
    expect(url).toBe("https://llm.example/v1/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer k" });
    expect(init.body).toBe('{"model":"m","n":1}');
    expect(await post(answering(200, "").fetchImpl)).toEqual({});
  });

  it("fails a success that isn't JSON as an overloaded upstream", async () => {
    await expect(post(answering(200, "<html>").fetchImpl)).rejects.toMatchObject({
      kind: "upstream",
      status: 200,
      provider: "groq",
      model: "model-x",
      message: "Example model-x: returned invalid JSON",
    });
  });

  it("words a refusal from its error message, else from the start of its text, else from its status alone", async () => {
    await expect(post(answering(503, '{"error":{"message":"overloaded"}}').fetchImpl)).rejects.toMatchObject({
      kind: "upstream",
      status: 503,
      message: "Example model-x: HTTP 503: overloaded",
    });
    const page = `<html>${"x".repeat(300)}`;
    const fromText = post(answering(502, page).fetchImpl);
    await expect(fromText).rejects.toBeInstanceOf(LlmError);
    await expect(fromText).rejects.toMatchObject({ message: `Example model-x: HTTP 502: ${page.slice(0, 200)}` });
    await expect(post(answering(500, "").fetchImpl)).rejects.toMatchObject({ message: "Example model-x: HTTP 500" });
  });

  it("classifies by status and reads Retry-After unless the provider says otherwise", async () => {
    await expect(post(answering(429, "{}", { "retry-after": "12" }).fetchImpl)).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 12_000,
    });
    await expect(post(answering(401, "{}").fetchImpl)).rejects.toMatchObject({ kind: "auth", retryAfterMs: undefined });

    const told = post(answering(400, '{"error":{"message":"bad","code":"json_validate_failed"}}', { "retry-after": "12" }).fetchImpl, {
      kind: (status, reply, reason) => (reply.error?.code === "json_validate_failed" && reason === "bad" ? "invalid_output" : "auth"),
      retryAfterMs: (reply) => (reply.error?.message === "bad" ? 5_000 : undefined),
    });
    await expect(told).rejects.toMatchObject({ kind: "invalid_output", status: 400, retryAfterMs: 5_000 });
  });
});
