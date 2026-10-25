# Mise: treatments with taste

Mise is an agentic pre-production assistant for music-video and short-film directors. Give it an artist (or a few
reference films), a shoot city and a budget, and it builds a treatment grounded in what that audience actually loves:
reference films, wardrobe brands and real shoot locations, each with the evidence behind it.

> **Status:** work in progress for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). The treatment builder
> runs end to end: Qloo tools, a lean LLM agent on free tiers, and the board UI. Persistence, share links and director
> taste import come next.

## Why Qloo

A treatment is the document a director writes to win a job: concept, references, wardrobe, locations. Today it reflects
the director's own reference memory, while the client cares whether it lands with *their* audience. A general-purpose
LLM doesn't fix that: it suggests the same canon for every brief, invents locations and has no idea who the fans are.

Mise uses Qloo's taste graph as the source of truth:

- **Cross-domain affinity:** what an artist's audience over-indexes on in film, fashion and places.
- **Taste profiles and demographics:** the audience's vocabulary (themes, styles, ambiences) and who they are.
- **Audience comparison:** where the director's own film taste meets the artist's audience.
- **Real places:** venues in the shoot city whose ambience fits and whose regulars share the taste.

## How a treatment is built

Code runs every Qloo call; the LLM is called at most three times per treatment (normally two), so the whole thing fits
free-tier limits.

1. **Intake** is a form, so no LLM is spent parsing it.
2. **Resolve** the artist, touchstone films and the director's own films (`resolve_entities`). Names that match more
   than one title go to a picker in the UI instead of being guessed; only Qloo's own candidates can be picked. A year
   in brackets, like "Rockstar (2011)", settles it without asking, and so does one match being far better known than
   the rest (the treatment notes which one was used).
3. **Read the audience** (`read_audience`) and, when the director lists films, **compare** their taste with the
   audience (`taste_overlap`). The two calls run at once.
4. **Plan (LLM call 1).** The model picks the creative direction, the tone tags, an era, how deep the cuts go, and a
   few plain style words for wardrobe and ambience. Tags are shown to it as short refs (`T1`, `T2`, ...) and the output
   schema only accepts those refs, so it cannot invent a tag ID.
5. **Execute in code.** The style words go through `find_tags` (preferring tags named like the word, never
   adult-themed ones). Three Qloo queries run in parallel; reference films start straight away, since they don't
   use the tags:
   - `reference_films`: the artist's audience, with a popularity ceiling for deep cuts and an era only when the
     director asks for "more 90s".
   - `styling_brands`: fashion brands only (`urn:tag:genre:brand:fashion`), ranked by the wardrobe style tags.
   - `scout_locations`: the venue kinds the plan chose (cafe, bar, bookstore, park and so on, mapped to Qloo place
     genres), ranked by the ambience tags, within the budget's price level, with photos.

   Empty or failed results are relaxed deterministically (widen the venue kinds, allow places without photos, lift
   the price ceiling, drop style tags, lift the deep-cut ceiling), and the treatment says what was relaxed.
6. **Re-plan (optional LLM call 2)** only when a whole set of style words matched no Qloo tag.
7. **Write (last LLM call).** The model writes the treatment as JSON, citing films, brands and places only by ref
   (`R1`, `B1`, `L1`); refs not returned by a tool fail validation. Code maps refs back to Qloo items and attaches each
   item's evidence (rank within its call, affinity, popularity, the input entities that drove it) and the model that
   wrote it. A ref that slips into the prose is swapped for its name, and lighting or shot notes sent as objects are
   flattened, so neither costs a repair call.

Iterate chips (darker, more 90s, deeper cuts, cheaper locations) re-run plan and write; Qloo lookups come from cache.

### Featured treatments

Four example briefs (`src/lib/agent/examples.ts`) are pre-built with deep thinking, so the home page opens with
finished treatments and clicking one shows it at once, whatever the live rate limits are doing.

- `npm run featured` builds them from live Qloo and DeepSeek. A run only counts if every Qloo call worked, no step fell
  back to the template, and DeepSeek wrote it (when its key is set). Each brief gets two tries, and a failed rebuild
  keeps the previous treatment.
- They are written to `.cache/featured/featured.json`, which is gitignored, because Qloo data is never committed. Each
  deploy builds its own set: `prebuild` runs `npm run featured -- --if-missing` before `next build`. Without live keys it
  skips, and the examples stay plain buttons that run live.
- The treatment API answers a featured brief like a cache hit that never expires. A server running on mocks ignores
  them. `outputFileTracingIncludes` puts the file in the route's server bundle.

### What live Qloo taught the design (2026-10-25)

- Films carry `style:qloo` tags that read like cinematography notes ("Stark close ups", "Domestic scale
  cinematography"); Mise shows those first and hands them to the writer, so "what to borrow" is grounded in Qloo.
- Tag signals on film queries made Qloo run 22-60 s and end in a 504, so films use the artist signal alone (about
  1.4 s). Brand queries without the fashion filter returned snack and drink brands.
- `tourist_attraction` is on hotels and golf clubs, so it is not a venue kind. Places carry Qloo's own
  `ambience_description`, shown as evidence on each location. Chain branches ("Starbucks - Juhu") are collapsed to
  the best-ranked one.

### LLM layer (`src/lib/llm`)

`generateJson({ system, prompt, schema, mock })` is provider-neutral:

- Every output is validated with zod. Invalid output gets one repair retry on the same model, with the validation
  problems in the prompt.
- The chain falls through on 429, 5xx, timeouts and invalid output: **DeepSeek `deepseek-flash`** when its (paid)
  key is set (JSON mode with the schema in the prompt, thinking at the brief's depth), then the free tiers: **Gemini
  `gemini-3.5-flash-lite`** (Google AI Studio, thinking level low for planning and medium for writing), **Groq
  `openai/gpt-oss-120b`** (strict JSON schema, low reasoning effort, compact prompts for its 8K tokens/minute limit),
  and **`gemini-3.8-flash`** as a last resort.
- The order comes from a head-to-head on live Qloo data (same briefs, same Qloo results). DeepSeek wrote clearly
  better treatments: "what to borrow" notes like "observational framing, long deadpan holds" where Flash-Lite wrote
  "framing", outfits down to fabric and fit, budget-aware lighting, shots with lenses. 3.8 Flash returned 503s or
  took over 100 s per call. DeepSeek V4 Pro lost to Flash on quality, speed and cost.
- **Thinking depth.** Each brief chooses how long DeepSeek thinks: **Deep** (the default, high reasoning effort) or
  **Quick** (low). Two blind judges scored deep treatments 8.5 out of 10, quick ones 8.1 and thinking-off ones 5.8,
  judged side by side on live Qloo. A deep treatment takes about 35-45 s, a quick one about 25-35 s, and either costs
  under a cent. The free fallbacks ignore the setting: more thinking made them slower, not better. A quick brief is
  answered from a cached deep treatment of the same brief when there is one.
- **Where the time goes.** Profiled live, a deep treatment spends about 31 of its 36-42 s in DeepSeek (plan 4-5 s,
  write 26-31 s) and about 6 s in Qloo. The time limits are Mise's own (`TIMING` in `src/lib/agent/pipeline.ts`):
  deep allows 20 s to plan, 60 s to write and 120 s in all, quick 15, 45 and 90 s, each leaving room for one fallback.
  While a model thinks, the timeline counts the seconds, which also keeps the stream alive.
- Array limits ("4-6 colours") are stated to the model but applied in code, so one extra item never costs a repair.
- A provider that times out, is overloaded or is rate limited rests for one to two minutes (longer if it sends a retry
  delay), so the next step goes straight to one that works. Every call is also bounded by the time left in the run,
  with time held back for the writing step.
- With no keys, `LLM_MODE=mock`, a spent daily cap, or every provider down, a deterministic template plans and writes.
  Its output is always labelled **Mock LLM**, and the result records which model produced each step.

Both providers are called over REST (`generateContent` with `responseJsonSchema`; OpenAI-compatible chat completions
with `response_format: json_schema`), so there are no SDK dependencies.

## Agent tools

Each tool is a typed, provider-neutral definition (zod schema exported as JSON Schema) and returns a uniform result:
status, a one-line summary, compact data, warnings and the provenance of every Qloo request it made.

| Tool | What it does | Qloo endpoint(s) |
| --- | --- | --- |
| `resolve_entities` | Names to Qloo IDs; asks the user about ambiguous names | `GET /search` |
| `import_external_ids` | IMDb / Spotify IDs to Qloo entities (e.g. a director's watch history) | `GET /entities` |
| `find_tags` | Mood or style words to tag IDs | `GET /v2/tags` (semantic search) |
| `read_audience` | Taste vocabulary plus age/gender skew of an audience | `GET /v2/insights` (`urn:tag`, `urn:demographics`) |
| `taste_overlap` | Shared traits between the director's taste and the artist | `GET /v2/analysis/compare` |
| `reference_films` | Films/shows the audience loves, with era and deep-cut controls and explanations | `GET /v2/insights` (movie, tv_show) |
| `styling_brands` | Fashion and lifestyle brands for wardrobe | `GET /v2/insights` (brand) |
| `scout_locations` | Real places in the shoot city by ambience, budget and photo | `GET /v2/insights` (place) |

## Getting started

Requires Node 22.12 or newer (`.nvmrc` pins 24).

```bash
nvm use
npm install
cp .env.example .env.local   # optional: add QLOO_API_KEY, GEMINI_API_KEY, GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

With no keys at all the app still runs end to end on the synthetic Qloo mock and the mock LLM, both clearly labelled.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server: the treatment builder at `/`, the tool playground at `/playground` |
| `npm test` | Unit tests (always against the mocks and fake LLM providers, never live APIs) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run smoke` | Day-1 checks of the live Qloo data Mise depends on (about 30 requests) |
| `npm run smoke:mock` | Same script against the mock, to test the script itself |
| `npm run featured` | Pre-build the featured treatments (live keys; `-- --only=<slug>` rebuilds one) |

### Environment variables

All server-side only.

| Variable | Description |
| --- | --- |
| `QLOO_API_KEY` | Qloo hackathon key |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com`, the only host hackathon keys work on |
| `QLOO_MODE` | `live` or `mock`; defaults to `live` when a key is set |
| `QLOO_CACHE_DIR` | Optional on-disk response cache (gitignored) |
| `GEMINI_API_KEY` | Google AI Studio key (free tier) |
| `GROQ_API_KEY` | Groq key (free tier), the backup provider |
| `LLM_MODE` | `live` or `mock`; defaults to `live` when either LLM key is set |
| `DEEPSEEK_API_KEY` | Optional, paid: when set, DeepSeek plans and writes first (under a cent a treatment) and the free tiers become fallbacks |
| `DEEPSEEK_MODEL` / `GEMINI_MODEL` / `GROQ_MODEL` / `GEMINI_FALLBACK_MODEL` | Models in chain order (defaults `deepseek-flash`, `gemini-3.5-flash-lite`, `openai/gpt-oss-120b`, `gemini-3.8-flash`); `none` drops a Gemini one |
| `LLM_DAILY_CAP` | Real LLM calls per UTC day per instance before the mock takes over (default 300) |
| `LLM_TIMEOUT_MS` | Per-call timeout for calls that don't set their own (default 20000); treatment steps use `TIMING` |
| `MISE_TOOL_PLAYGROUND` | `1` enables `/playground` and `/api/tools/*` in production builds (set at build time) |

### API routes

- `POST /api/treatment`: takes a brief, streams progress as server-sent events (`start`, `step`, `needs_input`,
  `treatment`, `error`, `done`). Guarded by a per-IP rate limit (6 fresh treatments a minute), a daily LLM-call cap, a
  run budget (120 s deep, 90 s quick, under a 150 s `maxDuration`) and a 24-hour cache keyed by the normalized brief.
- `GET /api/health`: makes a real Qloo call and reports mode, host and provenance, plus the LLM chain (never called).
- `GET /api/tools`: tool definitions (JSON Schema) with an example input each.
- `POST /api/tools/{name}`: runs a tool (development only unless `MISE_TOOL_PLAYGROUND=1`).

## How it works

- `src/lib/qloo`: a small Qloo client. GET only, `X-Api-Key` header, bounded retries with `Retry-After`, response
  caching, clear error kinds (a 403 for an unsupported entity type is not reported as a bad key), warnings for
  parameters Qloo would silently ignore, and provenance for every request.
- `src/lib/qloo/mock`: a fake Qloo server over a small **synthetic** catalog, so the app and tests run without a key.
  Mock responses are labelled; names are real but every score and tag assignment is invented.
- `src/lib/tools`: the agent tools described above.
- `src/lib/llm`: the provider-neutral JSON generator and fallback chain.
- `src/lib/agent`: the brief schema, plan and write prompts (with their deterministic mocks), the pipeline, and the
  rate limit, cache and SSE service behind `/api/treatment`.
- `src/app/studio`: the treatment builder UI: intake, live agent timeline with every Qloo request, ambiguity picker,
  and the board with "why" popovers that keep Qloo's evidence apart from Mise's interpretation.

## Data handling

- No personal data is sent to Qloo or to the LLM; Mise works from names of public works and aggregate audience taste.
- Qloo results are presented as aggregate affinities, visibly separate from the agent's own interpretation. The model
  is told never to infer health, politics, finances, identity or eligibility from taste.
- Keys stay on the server, and Qloo responses are never committed to this repository.

## Limitations

- Rate limits, the daily LLM cap and the treatment cache live in process memory, so each serverless instance keeps its
  own. That is enough to protect free-tier quota for a demo, not to meter users. The per-IP limit trusts
  `x-forwarded-for`, which is right on Vercel but spoofable behind other proxies, and identical cold briefs arriving
  at once each run their own pipeline.
- A treatment that hit a failed Qloo call or a template-written step is shown (and says so) but never cached.
- The free Gemini tier may use prompts to improve Google's products; Mise only sends public names and Qloo tags.
- Location results are candidates to scout: availability and filming permission must be confirmed with each venue.

## License

[MIT](LICENSE)
