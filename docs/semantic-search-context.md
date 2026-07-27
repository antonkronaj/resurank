# Context: Semantic search over saved jobs and resumes

> **Status: not started.** This is design context for a future feature, not a
> plan of record. Nothing here has been built. Written 2026-07-26 as a handoff
> so the design conversation can resume in a fresh session.

## The feature

Two related capabilities, both enabled by persisting embedding vectors:

1. **"Find saved jobs similar to this one."** Given a job description (a new
   one, or an existing `score_history` row), return the user's other saved JDs
   ranked by semantic similarity.
2. **"Rank all my resumes against this JD."** Given one job description, score
   every resume the user has stored and rank them. Web build only — the desktop
   app has exactly one resume.

## Why this idea came up

The original question was narrower: *should we store the JD embedding so
re-scoring a JD against a different resume is cheaper?* That was investigated
and **rejected as a caching optimization**, for reasons that still hold:

- `packages/scoring/src/worker-embedder.ts` already keeps an in-memory LRU
  `textCache` (`Map<string, number[]>`, `DEFAULT_CACHE_SIZE = 16`) keyed on the
  exact input text. Within a browser session, re-scoring the same JD against a
  different resume already hits that cache for free.
- Scoring calls `embedder.embed([resumeInput, jobInput])` as one batch, so
  caching the JD only ever saves *one of two* embeddings — the new resume still
  has to be embedded.
- There is currently **no UI path** to re-score a saved JD. History is
  read-only; no re-score action exists anywhere in `apps/ui/src/app/web/history/`.
- Stored as the obvious `jsonb` array of JS floats, a 512-dim vector is ~10KB
  (each float serializes to ~20 chars) versus a typical JD of 2–5KB of text —
  i.e. the derived artifact would be 2–4× larger than its source, duplicated
  per history row.

**Semantic search is the compelling reason to store vectors — not caching.** It
is a user-visible feature rather than an optimization nobody would perceive, and
it justifies the storage cost that caching does not.

## Verified facts about the current system

Everything in this section was confirmed by reading code / querying the running
database, not assumed.

### Scoring model

- Hybrid score: **60% semantic + 40% TF-IDF**, with a divergence adjustment and
  optional missing-keyword and preference-mismatch penalties. Core:
  `packages/scoring/src/score.ts`, `scoreResumeAgainstJob()` at line 176.
- Embedding model: **`Xenova/jina-embeddings-v2-small-en`**, **512 dimensions**
  (confirmed from the downloaded `config.json` `hidden_size`; `max_position_embeddings`
  is 8192).
- `EMBEDDING_CHAR_CAP = 6_000` (`packages/scoring/src/constants.ts`).
- Output vectors are **already unit-normalized**, so a dot product *is* the
  cosine (stated in `score.ts:229-230` and relied on by `dotProduct()`).

### Exact embedding inputs (critical — any cache/index key must match these)

```ts
// score.ts:231-233
const resumeInput = sanitizeForEmbedding(resumeText).slice(0, EMBEDDING_CHAR_CAP);
const jobInput = sanitizeForEmbedding(`${job.title}. ${job.description}`).slice(0, EMBEDDING_CHAR_CAP);
const [resumeVec, jobVec] = await embedder.embed([resumeInput, jobInput]);
```

Note the JD input includes **the title**, joined by `". "` — not the description
alone. A vector keyed on `score_history.job_description` alone would be wrong.

### Where inference runs

- **All embedding is client-side**, in a Web Worker, in the browser (or in Node
  for the MCP server via `@resurank/scoring/node-embedder`).
- **`apps/web` performs no ML at all.** It is auth + Postgres CRUD + email +
  static hosting. Its Docker image deliberately prunes the entire ONNX /
  `@huggingface/transformers` tree (~390MB), and the build has a guard that
  fails if `apps/web/src` ever imports `@resurank/scoring/node-embedder`. See
  `apps/web/Dockerfile`.
- The web build serves the model **same-origin** from
  `apps/ui/public/assets/models/` (fetched at build time by
  `apps/ui/scripts/fetch-model.mjs`) because COEP `require-corp` blocks a
  cross-origin fetch from huggingface.co outright.

### Current database schema (`apps/web/src/db/schema.ts`)

Tables: `users`, `sessions`, `email_tokens`, `resumes`, `user_settings`,
`score_history`. Relevant columns:

- `resumes`: `id`, `user_id`, `filename`, `text` (**extracted text only — the
  PDF binary never leaves the client, and there is deliberately no binary
  column**), `terms` (jsonb `string[]`), `uploaded_at`, `is_active`. A partial
  unique index enforces at most one active resume per user.
- `score_history`: `id`, `user_id`, `resume_id` (FK, `on delete set null`),
  `resume_filename`, `job_title`, `job_description` (full text), `score`
  (double precision, denormalized from `result.score` for sorting), `result`
  (jsonb `MatchResult`), `created_at`.

**No vector columns exist anywhere today.**

### `MatchResult` shape (`packages/scoring/src/types.ts:44`)

`score`, `matchedTerms`, `missingTerms`, `pinnedNotInJob`, `breakdown`
(six numbers, including `embeddingScore` — a *similarity scalar*, not a vector),
`jobWeighted`, `jobCounts`, `languageWarning`.

There is **no field capable of holding a vector**, so nothing is persisted today
from which one could be recovered.

### Infrastructure blockers found

- **`postgres:17-alpine` does not ship pgvector.** Verified against the running
  dev container: `select count(*) from pg_available_extensions where name='vector'`
  returns `0`. Using pgvector means switching the image (e.g.
  `pgvector/pgvector:pg17`) in `apps/web/docker-compose.yml`, **and** confirming
  the production Postgres has the extension available.
- **Good news: no new npm dependency is needed.** The installed `drizzle-orm@0.38.4`
  already exports `vector()` plus `PgHalfVector`, `PgBinaryVector`, and
  `PgSparseVector` builders.
- **Relevant precedent:** `schema.ts:47-49` deliberately avoids the `citext`
  extension, using a `lower()` unique index instead, with the comment "not every
  managed Postgres enables [it] by default." Whoever picks up this feature should
  weigh pgvector against exactly that same standard — it is a heavier ask than
  citext.

## Open design questions

These need decisions before implementation. Ordered roughly by how much they
change the design.

1. **Does "rank all my resumes against this JD" use cosine, or the real score?**
   This is the sharpest tension. The app's headline number is the *hybrid*
   60/40 score with penalties — not raw embedding similarity. Ranking resumes by
   pure vector cosine is cheap and indexable, but would produce a **different
   order** than the app's own scoring, so a user could see resume A rank first
   in the new view and second after actually scoring it. Options: (a) use cosine
   only as a fast pre-filter, then run real scoring on the top N; (b) run full
   `scoreResumeAgainstJob()` for every resume client-side and don't use vector
   search for this at all; (c) accept and clearly label two different notions of
   "match." **(a) or (b) seem defensible; (c) seems bad.**

2. **Where does embedding happen, and does the server stay ML-free?** Keeping
   inference client-side preserves the current architecture, the pruned image,
   and the privacy story — but then the client must compute and upload vectors,
   and backfilling existing history means the client re-embedding old rows.
   Server-side embedding would undo the ~390MB image prune and the build guard.
   **Strong recommendation: keep the server ML-free; treat vectors as
   client-computed data the server merely stores.**

3. **Storage representation.** `vector(512)` via pgvector (2KB, indexable with
   HNSW/IVFFlat) vs `bytea` float32 (2KB, no index — fine for a few hundred rows
   per user, brute-force cosine in SQL or in JS) vs `jsonb` (~10KB, don't).
   Given per-user row counts are likely small (hundreds, not millions), **`bytea`
   or `halfvec` may be entirely sufficient and avoids the extension dependency** —
   worth benchmarking before committing to pgvector.

4. **Staleness / versioning.** A stored vector is valid only for one exact tuple:
   model ID + revision + `sanitizeForEmbedding()` implementation +
   `EMBEDDING_CHAR_CAP` + the `` `${title}. ${description}` `` template. Change
   any one and stored vectors silently produce wrong results — no crash, no type
   error. `EMBEDDING_CHAR_CAP` lives in the file CLAUDE.md describes as "all
   numeric tuning weights," i.e. a file meant to be tuned. **Any schema here needs
   a version/model tag column, and a mismatch must be treated as a miss.**

5. **Backfill.** ~All existing `score_history` rows have no vector. Do they get
   lazily embedded on next view, bulk-embedded client-side on some trigger, or
   simply excluded from search until re-scored?

6. **Desktop parity.** `apps/desktop` stores everything as local JSON files and
   has no Postgres and exactly one resume. Is this web-only (fine, and consistent
   with multi-resume/history already being web-only), or does desktop need a
   local equivalent?

7. **Scope of "similar."** Similar to a *saved* JD only, or also "paste a new JD,
   find similar saved ones"? The latter needs an embedding computed for a JD that
   was never scored/saved.

## Recommended starting shape

An opinion, not a decision — argue with it:

- Web-only. Keep `apps/web` ML-free; vectors are computed in the browser and
  POSTed as data.
- Start with **`bytea` float32 + brute-force cosine**, not pgvector. Per-user
  vector counts are small, it needs no extension, no image change, and no
  production infra ask. Revisit pgvector only if measurements justify it.
- Store JD vectors **deduplicated by a hash of the exact embedding input**
  (`sanitizeForEmbedding(`${title}. ${description}`).slice(0, CAP)`), not one per
  history row — the same JD scored against three resumes should store one vector.
- Every vector row carries a `model_version` tag covering model + revision + cap;
  mismatches are ignored, never used.
- Ship "find similar saved jobs" first (pure retrieval, low correctness risk).
  Defer "rank all my resumes" until question 1 above is settled, since it's the
  one that can visibly contradict the app's own score.

## Repo constraints to respect

From `CLAUDE.md`:

- **Do not add new dependencies without asking first.** (pgvector is a Postgres
  *extension* + docker image change rather than an npm dep — drizzle already
  supports it — but it is still an infra ask.)
- Keep scoring logic in `packages/scoring`; it is a published npm package and must
  stay framework-agnostic.
- Use Angular components for UI work; no vanilla DOM manipulation.
- `packages/` = published to npm; `apps/` = deployed, never published.
- Never commit/merge/push/rebase the `main` branch.
- Run `graphify update .` after modifying code.

Testing/infra notes:

- `apps/web` has 66 integration tests across 17 suites, run serially against a
  real Postgres + Mailpit (`npm --prefix apps/web run db:up` first, then
  `npm --prefix apps/web run test`).
- Migrations: `npm --prefix apps/web run db:generate` → `apps/web/drizzle/` →
  applied in production via `node apps/web/dist/db/migrate.js` (deliberately not
  `drizzle-kit`, which is a devDependency absent from the production image).
- Local Postgres is on **port 5433** (not 5432), compose project name pinned to
  `resurank`.

## Key files

| Path | What |
|---|---|
| `packages/scoring/src/score.ts` | `scoreResumeAgainstJob()`, embedding inputs (L231-233), cosine via `dotProduct()` |
| `packages/scoring/src/types.ts` | `MatchResult`, `Embedder` interface |
| `packages/scoring/src/constants.ts` | `EMBEDDING_CHAR_CAP`, scoring weights |
| `packages/scoring/src/worker-embedder.ts` | Browser embedder + existing LRU `textCache` |
| `apps/web/src/db/schema.ts` | Drizzle schema — where vector columns would go |
| `apps/web/src/routes/history.ts` | History CRUD; where a search endpoint would likely live |
| `apps/web/src/lib/validation.ts` | Zod request schemas |
| `apps/ui/src/app/shared/matcher.service.ts` | Angular wrapper calling the scoring package |
| `apps/ui/src/app/web/history/` | History UI (currently read-only) |
| `apps/web/docker-compose.yml` | Dev Postgres image (`postgres:17-alpine`) |
| `docs/deployment-runbook.md` | Production deploy; would need updating for any extension |

## One correction to make if this ships

`apps/web/README.md` and the root `README.md` both state the server "performs no
ML." Storing embeddings would put the first ML-*derived* artifact in the
database. That claim stays technically true if inference remains client-side,
but the wording deserves a pass so it isn't misleading.

Worth noting the privacy objection here is weaker than it first appears: the
server **already stores the full job description text** and full resume text, and
an embedding is strictly less information than its source. The real objections
are storage cost and silent staleness, not a new class of data exposure.
