# itsgiving: treatments with taste

itsgiving is an agentic pre-production assistant for music-video and short-film directors. Give it an artist (or a few
reference films), a shoot city and a budget, and it builds a treatment grounded in what that audience actually loves:
reference films, wardrobe brands and real shoot locations, each with the evidence behind it.

The name is Gen Z slang: "it's giving…" means "this has the vibe of…", which is what a treatment tells a client.

> **Status:** work in progress for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). The treatment builder
> runs end to end on live Qloo: the Qloo tools, a lean LLM agent (DeepSeek first, free models as fallbacks), the board
> UI, four pre-built featured treatments, and a director's taste imported from a TMDB list or IMDb links.

## Why Qloo

A treatment is the document a director writes to win a job: concept, references, wardrobe, locations. Today it reflects
the director's own reference memory, while the client cares whether it lands with *their* audience. A general-purpose
LLM doesn't fix that: it suggests the same canon for every brief, invents locations and has no idea who the fans are.

itsgiving uses Qloo's taste graph as the source of truth:

- **Cross-domain affinity:** what an artist's audience over-indexes on in film, fashion and places.
- **Taste profiles and demographics:** the audience's vocabulary (themes, styles, ambiences) and who they are.
- **Audience comparison:** where the director's own film taste meets the artist's audience.
- **Locality intelligence:** Qloo's heatmap of the shoot city shows where the audience over-indexes; the shoot is
  based in one of those areas.
- **Real places:** venues near that base whose ambience fits and whose regulars share the taste.

## How a treatment is built

Code runs every Qloo call; the LLM is called at most three times per treatment (normally two), which keeps a treatment
fast and cheap, and within the free fallback models' limits.

1. **Intake** is a form, so no LLM is spent parsing it.
2. **Resolve** the artist, touchstone films and the director's own films (`resolve_entities`). A director can also import
   their taste: a public TMDB list or pasted IMDb links become up to 25 films that Qloo looks up by IMDb ID
   (`import_external_ids`), so nothing about them is guessed. Names that match more
   than one title go to a picker in the UI instead of being guessed; only Qloo's own candidates can be picked. A year
   in brackets, like "Rockstar (2011)", settles it without asking, and so does one match being far better known than
   the rest (the treatment notes which one was used). When no title has the name as typed, the picker says so and
   offers only near misses (a small typo, or a word in common) plus "None of these"; Qloo's search always returns its
   closest names, and for an artist it doesn't have those are other artists entirely. An artist with no exact match
   is also looked for among Qloo's people, where it files some musicians (Raftaar, MC Stan). For an artist Qloo
   doesn't have at all, the director can name up to three **stand-in artists** with a similar audience: their fans
   carry the audience, the treatment keeps the artist's name, and the model is told to say nothing about the artist
   beyond it. The shoot city is resolved too, as a Qloo locality: a state or county that shares its name with a city
   ("New York") is read as the city.
3. **Read the audience** (`read_audience`), **map where the fans are** (`audience_heatmap`) and, when the director
   lists films, **compare** their taste with the audience (`taste_overlap`). The calls run at once. The heatmap scores
   every tile of the city for the audience; itsgiving groups the hottest tenth into the three strongest areas, 2 km in
   radius, and names each after the neighbourhoods Qloo lists around its centre. Tags that name who people are
   (sexual orientation, gender identity, religion, ethnicity, health, party politics) are dropped here: Qloo has some
   as film themes, but a treatment never describes its audience by who they are.
4. **Plan (LLM call 1).** The model picks the creative direction, the tone tags, how deep the cuts go, a few plain
   style words for wardrobe and ambience, and which of the strongest areas to base the shoot in. Tags and areas are
   shown to it as short refs (`T1`, `A1`, ...) and the output schema only accepts those refs, so it cannot invent a
   tag ID or a neighbourhood.
5. **Execute in code.** The style words go through `find_tags` (preferring tags named like the word, never
   adult-themed ones). Three Qloo queries run in parallel; reference films start straight away, since they don't
   use the tags:
   - `reference_films`: the artist's audience, with a popularity ceiling for deep cuts and an era only when the
     director asks for "more 90s".
   - `styling_brands`: fashion brands only (`urn:tag:genre:brand:fashion`), ranked by the wardrobe style tags.
   - `scout_locations`: within 2 km of the chosen base, the venue kinds the plan chose (cafe, bar, bookstore, park
     and so on, mapped to Qloo place genres), ranked by the ambience tags, within the budget's price level, with photos.

   Empty or failed results are relaxed deterministically (widen from the base to the whole city when fewer than three
   places match near it, widen the venue kinds, allow places without photos, lift the price ceiling, drop style tags,
   lift the deep-cut ceiling), and the treatment says what was relaxed.
6. **Re-plan (optional LLM call 2)** only when a whole set of style words matched no Qloo tag.
7. **Write (last LLM call).** The model writes the treatment as JSON, citing films, brands and places only by ref
   (`R1`, `B1`, `L1`); refs not returned by a tool fail validation. Code maps refs back to Qloo items and attaches each
   item's evidence (rank within its call, affinity, popularity, the input entities that drove it) and the model that
   wrote it. A ref that slips into the prose is swapped for its name, and lighting or shot notes sent as objects are
   flattened, so neither costs a repair call. While the model writes, TMDB gives each reference film's still (its
   backdrop, by IMDb ID): the cover and the reference cards show film frames, not posters, whose own lettering would
   fight the treatment's title.

Iterate chips (darker, more 90s, deeper cuts, cheaper locations) re-run plan and write; Qloo lookups come from cache.

### The board

- **Two voices, never mixed.** Qloo's evidence is printed on receipt slips (rank within its call, affinity, the input
  that drove it). The treatment's own writing is set in a serif.
- **"it's giving".** The tone tags Qloo found, with the ones shared with the director's taste highlighted.
- **Title card.** A window of nine cinematic faces for the cover title, all free Google fonts standing in for a film
  look: a Futura-like face for Wes Anderson, Roman capitals for the Trajan poster meme, Courier Prime for a script page,
  and lettering from the Mumbai local's hand-painted signs. The starting face comes from the treatment's own evidence:
  the Qloo heatmap's shoot base in Mumbai, or a tone tag elsewhere.
- **unc mode.** The words around the work are Gen Z slang by default. A switch in the header turns them into plain
  English for producers, label people and judges. The treatment, the receipts and the run log read the same in both.
- **Section bar and pinned map.** Under the cover, one bar lists the sections, lights up the one being read and fills
  a thin line as you go; once the cover scrolls away, the title and the way back join it. In Locations, the
  shoot-base map stays put beside the places and lights up the pin of the one in view.
- **A map you can read.** The heatmap sits on the city's streets (OpenStreetMap, darkened), so the bright squares show
  where in the city the audience is strongest, around the three strongest areas and the numbered locations. The
  homepage draws a featured run's map with the same component.
- **Director's cut.** The Konami code letterboxes the page and brings out the board's extras: an INTERVAL card and a
  film edge under the beats. Escape puts them away.

### The pages

- **The homepage** explains and proves, and holds no form: the headline, a finished cover, "Start a treatment" and
  "See a finished one"; "Now showing", the other featured treatments as posters in a dark strip under a still
  projector beam (a sideways row on a phone), ending on a poster for the reader's own, the way into the studio; and
  "How it works", one real featured run step by step beside what each step produced. Nothing on it moves or changes
  as you scroll; the one motion is the cover opening like a letterbox when the page loads.
- **The studio** (`/studio`) is the tool. A music video starts from its artist and a city; a short film from the films
  it's after and a city. The rest waits under "Make it yours": a video's reference films and stand-in artists, a
  short's "music its audience loves" (an artist whose fans it's for, which shapes the audience, not the story), your
  own films, the budget and the thinking depth. "Your poster" fills in beside it. While a treatment builds, the brief folds into one line and the run takes the page: a countdown, the
  step it's on, every Qloo call, and the tab's title counting the seconds. Back from a board returns to the brief, and
  "Back to" the treatment's title opens it again, even after a visit to the homepage.
- **Featured treatments** (`/t/<slug>`) are pages of their own, built with the site, so Back, reload and links work as
  anywhere. A rework chip there hands the treatment to the studio, which opens it at once and re-runs it with the
  change. On every board, the section bar jumps within the page and puts the section in the address without adding
  history, so Back always leaves the page (or, in the studio, returns to the brief).
- **About** (`/about`) says who itsgiving is for first (music-video directors, short-film makers, and the labels,
  managers and producers who commission them), then what it is, what Qloo is, and how each step of a run uses Qloo.
- **Saved treatments** (`/s/<id>`), with accounts set up: Save on a studio board keeps the treatment in the director's
  account (signing in with Google or GitHub first if needed, then coming back to the same board, saved). Its page is
  private until its owner turns on the share link; then anyone with the link reads it, like an example, and its rework
  chips take it to the studio as their own take. **Your treatments** (`/saved`) lists them, and at its foot deletes
  the account along with everything saved in it.
- **One header on every page:** Examples, Studio and About, with the current section lit (a featured treatment counts
  as Examples), then the unc-mode switch, the account button (Sign in, or your initial with your treatments and Sign
  out) and the theme, since those choices carry across pages. Pages add only status badges, live or mock. On phones
  it takes two rows, and only the mock warnings among the badges show there.
- **Light or dark,** switched in the header and remembered per browser. Light is the default, and nothing on a page
  changes it.

### Featured treatments

Four example briefs (`src/lib/agent/examples.ts`) are pre-built with deep thinking, so the homepage opens with
finished treatments and each one's page shows it at once, whatever the live rate limits are doing.

- `npm run featured` builds them from live Qloo and DeepSeek. A run only counts if every Qloo call worked, no step fell
  back to the template, and DeepSeek wrote it (when its key is set). Each brief gets two tries, and a failed rebuild
  keeps the previous treatment.
- They are written to `.cache/featured/featured.json`, which is gitignored, because Qloo data is never committed. Each
  deploy builds its own set: `prebuild` runs `npm run featured -- --if-missing` before `next build`. Without live keys it
  skips: the homepage then shows no posters, and the featured pages offer their briefs to the studio instead.
- The homepage and the featured pages (`/t/<slug>`) are built from the file, and the treatment API answers a featured
  brief like a cache hit that never expires, so the studio reopens one at once. A server running on mocks ignores them,
  and a featured page then offers to fill its brief into the studio. `outputFileTracingIncludes` puts the file in each
  of those routes' server bundles.

### What live Qloo taught the design (2026-10-25)

- Films carry `style:qloo` tags that read like cinematography notes ("Stark close ups", "Domestic scale
  cinematography"); itsgiving shows those first and hands them to the writer, so "what to borrow" is grounded in Qloo.
- Tag signals on film queries made Qloo run 22-60 s and end in a 504, so films use the artist signal alone (about
  1.4 s). Brand queries without the fashion filter returned snack and drink brands.
- `tourist_attraction` is on hotels and golf clubs, so it is not a venue kind. Places carry Qloo's own
  `ambience_description`, shown as evidence on each location. Chain branches ("Starbucks - Juhu") are collapsed to
  the best-ranked one.
- A city name alone is ambiguous: `filter.location.query=New York` matches New York State, and one treatment got two
  venues in Hudson, NY, 200 km upstate. itsgiving now resolves the city to a locality ID first.
- The heatmap's own neighbourhood output (`output.heatmap.boundary=urn:entity:locality`) ships every locality's
  polygon: 5 MB for Mumbai, over 5 MiB for New York, and `take` doesn't trim it. The tile heatmap takes 0.5-1.1 s, and
  a `/search` for localities near a point (sorted by distance, no query) names an area in about 0.3 s. Live Qloo tags
  Manhattan as a "suburb" and returns Mumbai's wards with no kind, so names come from neighbourhood-sized localities
  that no other result lists as its parent.
- `/entities` by IMDb ID first echoed the IDs as a top-level `external` list of `[{id}]` (2026-10-24), then under
  `properties.external` as `{id, user_rating, ...}` (2026-10-25). itsgiving reads both, since the taste import matches each
  film back by its echoed ID.
- Heatmap `affinity` and `popularity` are percentiles across the city's tiles and track each other closely, but both
  are the audience's own: five very different artists' hottest tiles in New York overlapped 43% on average. itsgiving
  ranks tiles by affinity times popularity, which favours where the fans gather, and where there are places to shoot.

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
  write 26-31 s) and about 6 s in Qloo. The time limits are itsgiving's own (`TIMING` in `src/lib/agent/pipeline.ts`):
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
| `resolve_entities` | Names and cities to Qloo IDs; asks the user about ambiguous names | `GET /search` |
| `import_external_ids` | IMDb / Spotify IDs to Qloo entities (e.g. a director's watch history) | `GET /entities` |
| `find_tags` | Mood or style words to tag IDs | `GET /v2/tags` (semantic search) |
| `read_audience` | Taste vocabulary plus age/gender skew of an audience | `GET /v2/insights` (`urn:tag`, `urn:demographics`) |
| `taste_overlap` | Shared traits between the director's taste and the artist | `GET /v2/analysis/compare` |
| `audience_heatmap` | Where in a city an audience over-indexes, as named areas to base a shoot in | `GET /v2/insights` (`urn:heatmap`), `GET /search` (localities near a point) |
| `reference_films` | Films/shows the audience loves, with era and deep-cut controls and explanations | `GET /v2/insights` (movie, tv_show) |
| `styling_brands` | Fashion and lifestyle brands for wardrobe | `GET /v2/insights` (brand) |
| `scout_locations` | Real places in the shoot city, or near a point, by ambience, budget and photo | `GET /v2/insights` (place) |

## Getting started

Requires Node 22.12 or newer (`.nvmrc` pins 24).

```bash
nvm use
npm install
cp .env.example .env.local   # optional: add QLOO_API_KEY, GEMINI_API_KEY, GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

With no keys at all the app still runs end to end on the synthetic Qloo mock and the mock LLM, both clearly labelled.

Accounts (saving and sharing) are optional and run on [Supabase](https://supabase.com/). Without its keys every
account control hides itself. To try them locally (needs Docker), start a local Supabase and put the printed API URL,
publishable key and secret key in `.env.local`:

```bash
npx supabase start            # applies supabase/migrations; the ports are in supabase/config.toml
npx supabase status -o env    # API_URL, PUBLISHABLE_KEY, SECRET_KEY
```

For the hosted project: keep the Data API on and serving `public` when you create it ("Automatically expose new
tables" can stay off: the migration grants the server's role itself). Apply `supabase/migrations` (with
`npx supabase db push`, or by pasting the file into the SQL editor), turn on the Google and GitHub providers (their
callback is `https://<ref>.supabase.co/auth/v1/callback`) and turn off the Email provider. Set the Site URL to the
site, which lets sign-ins come back to its `/auth/callback`. To sign in from `npm run dev` against the hosted project,
also add `http://localhost:3000/**` to the redirect URLs: an exact `/auth/callback` entry won't match the `?next=` the
app adds. A project created with automatic RLS gets a function, `public.rls_auto_enable()`, that the Security Advisor
flags because the browser roles may call it: `revoke execute on function public.rls_auto_enable() from public, anon,
authenticated;` in the SQL editor clears that, and new tables still get RLS.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server: the treatment builder at `/`, the tool playground at `/playground` |
| `npm test` | Unit tests (always against the mocks and fake LLM providers, never live APIs) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run smoke` | Day-1 checks of the live Qloo data itsgiving depends on (about 30 requests) |
| `npm run smoke:mock` | Same script against the mock, to test the script itself |
| `npm run featured` | Pre-build the featured treatments (live keys; `-- --only=<slug>` rebuilds one) |

### Environment variables

All server-side only, except the two `NEXT_PUBLIC_` ones, which are meant for the browser.

| Variable | Description |
| --- | --- |
| `QLOO_API_KEY` | Qloo hackathon key |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com`, the only host hackathon keys work on |
| `QLOO_MODE` | `live` or `mock`; defaults to `live` when a key is set |
| `QLOO_CACHE_DIR` | Optional on-disk response cache (gitignored) |
| `GEMINI_API_KEY` | Google AI Studio key (free tier) |
| `GROQ_API_KEY` | Groq key (free tier), a fallback |
| `LLM_MODE` | `live` or `mock`; defaults to `live` when any LLM key is set |
| `DEEPSEEK_API_KEY` | Optional, paid: when set, DeepSeek plans and writes first (under a cent a treatment) and the free tiers become fallbacks |
| `DEEPSEEK_MODEL` / `GEMINI_MODEL` / `GROQ_MODEL` / `GEMINI_FALLBACK_MODEL` | Models in chain order (defaults `deepseek-flash`, `gemini-3.5-flash-lite`, `openai/gpt-oss-120b`, `gemini-3.8-flash`); `none` drops a Gemini one |
| `LLM_DAILY_CAP` | Real LLM calls per UTC day per instance before the mock takes over (default 300) |
| `LLM_TIMEOUT_MS` | Per-call timeout for calls that don't set their own (default 20000); treatment steps use `TIMING` |
| `ITSGIVING_TOOL_PLAYGROUND` | `1` enables `/playground` and `/api/tools/*` in production builds (set at build time) |
| `TMDB_API_KEY` | Optional: TMDB's "API Read Access Token" (or v3 API key), for importing a director's TMDB list and for the reference films' stills. IMDb links work without it; without stills, covers show the palette alone |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional: the Supabase project's URL and publishable key, which turn accounts on (read at build time) |
| `SUPABASE_SECRET_KEY` | With the two above: the project's secret key, used only on the server, to read and write saved treatments and to seal each treatment it builds so only those can be saved |

### API routes

- `POST /api/treatment`: takes a brief, streams progress as server-sent events (`start`, `step`, `needs_input`,
  `treatment`, `error`, `done`). Guarded by a per-IP rate limit (6 fresh treatments a minute), a daily LLM-call cap, a
  run budget (120 s deep, 90 s quick, under a 150 s `maxDuration`) and a 24-hour cache keyed by the normalized brief.
- `POST /api/taste`: takes `{ "source": "<TMDB list link or IMDb links>" }` and returns the films Qloo knows, by IMDb
  ID, plus the ones it left out. At most 26 TMDB calls and one Qloo call; 8 imports a minute per IP.
- `POST /api/saved`: saves `{ treatment, seal }` to the signed-in person's account. The seal must be the server's
  own (an HMAC it attached when it built the treatment), at most 100 per person; saving the same take again returns
  the same id.
- `PATCH /api/saved/{id}` with `{ "shared": true | false }`, and `DELETE /api/saved/{id}`: the owner's only; anyone
  else gets a 404.
- `DELETE /api/account`: deletes the signed-in person's account and every treatment they saved, which ends their
  share links. Only from the site's own pages (same-origin), and only ever the caller's own account.
- `GET /auth/callback`: where Google or GitHub sends someone back after signing in (through Supabase); it only ever
  returns them to a path on this site.
- `GET /api/health`: makes a real Qloo call and reports mode, host and provenance, plus the LLM chain (never called).
- `GET /api/tools`: tool definitions (JSON Schema) with an example input each.
- `POST /api/tools/{name}`: runs a tool (development only unless `ITSGIVING_TOOL_PLAYGROUND=1`).

## How it works

- `src/lib/qloo`: a small Qloo client. GET only, `X-Api-Key` header, paced under Qloo's 10 calls a second, bounded
  retries (a 429 waits out the rest of Qloo's one-second window), response caching, clear error kinds (a 403 for an
  unsupported entity type is not reported as a bad key), warnings for parameters Qloo would silently ignore, and
  provenance for every request.
- `src/lib/qloo/mock`: a fake Qloo server over a small **synthetic** catalog, so the app and tests run without a key.
  Mock responses are labelled; names are real but every score and tag assignment is invented.
- `src/lib/tools`: the agent tools described above.
- `src/lib/llm`: the provider-neutral JSON generator and fallback chain.
- `src/lib/agent`: the brief schema, plan and write prompts (with their deterministic mocks), the pipeline, and the
  rate limit, cache and SSE service behind `/api/treatment`.
- `src/app/studio`: the treatment builder UI: intake, live agent timeline with every Qloo request, ambiguity picker,
  and the board with "why" popovers that keep Qloo's evidence apart from itsgiving's interpretation.
- `src/lib/supabase`, `src/lib/saved`, `supabase/migrations`: accounts. Supabase Auth signs people in with Google or
  GitHub; the browser reads the session itself, so the static pages stay static, and `src/proxy.ts` keeps it fresh on
  the pages that read it on the server. Saved treatments sit in one table that grants browsers nothing: only the
  server reads and writes it, naming the owner in every query.

## Data handling

- No personal data is sent to Qloo or to the LLM; itsgiving works from names of public works and aggregate audience taste.
- Qloo results are presented as aggregate affinities, visibly separate from the agent's own interpretation. The model
  is told never to infer health, politics, finances, identity or eligibility from taste.
- Keys stay on the server, and Qloo responses are never committed to this repository.
- A TMDB import reads only the list's name and its films' titles, years and IMDb IDs. Nothing about the list's owner
  is kept, and only IMDb IDs go to Qloo.
- Accounts: Supabase keeps the name and email that Google or GitHub share at sign-in; itsgiving keeps the treatments
  people save, in a private database (they hold Qloo data, which may be stored privately but never in git). None of
  it goes to Qloo or the LLMs. A saved treatment is private until its owner shares it; shared pages are never indexed
  and don't name their owner, and deleting a treatment removes it and its link. Deleting the account (at the foot of
  `/saved`) removes the person's sign-in record and everything they saved.

## Limitations

- Rate limits, the daily LLM cap and the treatment cache live in process memory, so each serverless instance keeps its
  own. That is enough to protect free-tier quota and DeepSeek credit during a demo, not to meter users. The per-IP limit trusts
  `x-forwarded-for`, which is right on Vercel but spoofable behind other proxies, and identical cold briefs arriving
  at once each run their own pipeline.
- A treatment that hit a failed Qloo call or a template-written step is shown (and says so) but never cached.
- The free Gemini tier may use prompts to improve Google's products; itsgiving only sends public names and Qloo tags.
- Location results are candidates to scout: availability and filming permission must be confirmed with each venue.
- The shoot base is where the audience's signal is strongest, not a check on permits, crowds or access. The heatmap is
  aggregate taste by area and says nothing about the people who live there.
- Qloo's film catalog is feature-length: short films are missing even when they have IMDb pages (Oscar winners
  included), so a director's own shorts can't stand for their taste. Music is artist-level only, with no songs or
  albums, so a treatment reads the artist's audience, not the particular song.
- Qloo doesn't have every artist. Small acts can be there, yet others are missing, even ones MusicBrainz and Wikidata
  list, and some are filed only as people. A treatment for an artist Qloo lacks reads
  the audience of stand-ins the director names, which is an approximation and says so.
- Qloo's affinities describe what groups tend to like, never what any one person will do.
- Accounts run on Supabase's free plan, which pauses a project after a week without traffic: saving and shared pages
  then say they're unavailable until it's resumed, while building treatments carries on. Google's sign-in screen shows
  the Supabase project's address rather than itsgiving's name, which would need a verified domain.

## Credits

- Taste data: [Qloo](https://www.qloo.com/)'s Insights API.
- Imported film lists and film stills: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not
  endorsed or certified by TMDB.
- Street maps under the heatmap: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, from
  OpenStreetMap's standard tiles under its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## License

[MIT](LICENSE)
