# Mise: treatments with taste

Mise is an agentic pre-production assistant for music-video and short-film directors. Give it an artist (or a few
reference films), a shoot city and a budget, and it builds a treatment grounded in what that audience actually loves:
reference films, wardrobe brands and real shoot locations, each with the evidence behind it.

> **Status:** work in progress for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). The Qloo client and the
> agent's tools are built and tested; the LLM agent loop and the treatment UI are next.

## Why Qloo

A treatment is the document a director writes to win a job: concept, references, wardrobe, locations. Today it reflects
the director's own reference memory, while the client cares whether it lands with *their* audience. A general-purpose
LLM doesn't fix that: it suggests the same canon for every brief, invents locations and has no idea who the fans are.

Mise uses Qloo's taste graph as the source of truth:

- **Cross-domain affinity:** what an artist's audience over-indexes on in film, fashion and places.
- **Taste profiles and demographics:** the audience's vocabulary (themes, styles, ambiences) and who they are.
- **Audience comparison:** where the director's own film taste meets the artist's audience.
- **Real places:** venues in the shoot city whose ambience fits and whose regulars share the taste.

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
cp .env.example .env.local   # add QLOO_API_KEY; without it the app runs on mock data
npm run dev                  # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with the tool playground |
| `npm test` | Unit tests (always run against the mock, never the live API) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run smoke` | Day-1 checks of the live Qloo data Mise depends on (about 30 requests) |
| `npm run smoke:mock` | Same script against the mock, to test the script itself |

### Environment variables

| Variable | Description |
| --- | --- |
| `QLOO_API_KEY` | Qloo hackathon key (server-side only) |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com`, the only host hackathon keys work on |
| `QLOO_MODE` | `live` or `mock`; defaults to `live` when a key is set |
| `QLOO_CACHE_DIR` | Optional on-disk response cache (gitignored) |
| `MISE_TOOL_PLAYGROUND` | `1` enables `/api/tools/*` in production builds |

### API routes

- `GET /api/health`: makes a real Qloo call and reports mode, host and provenance.
- `GET /api/tools`: tool definitions (JSON Schema) with an example input each.
- `POST /api/tools/{name}`: runs a tool (development only unless `MISE_TOOL_PLAYGROUND=1`).

## How it works

- `src/lib/qloo`: a small Qloo client. GET only, `X-Api-Key` header, bounded retries with `Retry-After`, response
  caching, clear error kinds (a 403 for an unsupported entity type is not reported as a bad key), warnings for
  parameters Qloo would silently ignore, and provenance for every request.
- `src/lib/qloo/mock`: a fake Qloo server over a small **synthetic** catalog, so the app and tests run without a key.
  Mock responses are labelled; names are real but every score and tag assignment is invented.
- `src/lib/tools`: the agent tools described above.

## Data handling

- No personal data is sent to Qloo; Mise works from aggregate audience taste.
- Qloo results are presented as aggregate affinities, separate from the agent's own interpretation.
- The Qloo key stays on the server, and Qloo responses are never committed to this repository.

## License

[MIT](LICENSE)
