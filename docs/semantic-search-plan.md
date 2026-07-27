# Find similar saved jobs — semantic search over `score_history` (pgvector / pg18)

## Context

`docs/semantic-search-context.md` is a design handoff written 2026-07-26 arguing that ResuRank
should persist JD embedding vectors — **not** as a caching optimization (that was investigated
and rejected: the worker already has an LRU, scoring embeds resume+JD as one batch, and there
is no re-score UI path), but because it unlocks a real user-visible feature.

Today `MatchResult` stores `embeddingScore` — a *scalar* — and nothing else. The vector the
model produced is discarded microseconds after it is computed. There is no column anywhere in
`apps/web/src/db/schema.ts` capable of holding one, so a user with 200 saved job descriptions
has no way to ask "what else have I looked at that's like this?"

This plan ships the first of the two capabilities in that doc: **given a saved history entry,
return the user's other saved JDs ranked by semantic similarity.** The second ("rank all my
resumes against this JD") is explicitly deferred — it is the one that can visibly contradict
the app's own 60/40 hybrid score, and open question 1 in the doc is unresolved.

### Decisions taken (these close doc questions 2, 3, 4, 5, and half of 7)

| Decision | Choice |
|---|---|
| Scope | "Find similar saved jobs" only |
| Where inference runs | **Client-side, unchanged.** The server stays ML-free; vectors are uploaded as data |
| Storage | **pgvector** on `pgvector/pgvector:pg18` (overrules the doc's own bytea recommendation — the user wants to explore pgvector, and with no production infra yet the extension ask costs nothing today) |
| HNSW index | **Not now.** Documented for later |
| Endpoint | `GET /api/history/:id/similar` — query vector read from the owned row |
| Backfill | **None.** Pre-development rows simply never match. Dev DB gets wiped |
| Staleness | **A `job_vector_version` column, filtered at read time** |

### Why the version column is non-negotiable

A stored vector is valid for exactly one tuple: model id + revision + `dtype` + pooling +
`sanitizeForEmbedding()` + `EMBEDDING_CHAR_CAP` + the `` `${title}. ${description}` `` template.
Change any one and stored vectors produce **a number in the right range** — no crash, no NaN,
no type error, just quietly wrong rankings. `EMBEDDING_CHAR_CAP` lives in the file CLAUDE.md
describes as "all numeric tuning weights," i.e. a file whose purpose is being edited. With no
backfill mechanism, the version filter *is* the migration strategy: bump the constant and the
feature degrades to "not enough data yet" until normal re-scoring repopulates.

---

## Phase A — `packages/scoring`: export the embedding-input builders

The client must rebuild the **byte-identical** string that `scoreResumeAgainstJob()` embeds, or
the persisted vector describes different text than the score used. `sanitizeForEmbedding` is
currently module-private (`packages/scoring/src/score.ts:84`).

**New file `packages/scoring/src/embedding-input.ts`** — move `sanitizeForEmbedding` verbatim,
add:

```ts
export function buildJobEmbeddingInput(job: JobInput): string {
  return sanitizeForEmbedding(`${job.title}. ${job.description}`).slice(0, EMBEDDING_CHAR_CAP);
}
export function buildResumeEmbeddingInput(resumeText: string): string {
  return sanitizeForEmbedding(resumeText).slice(0, EMBEDDING_CHAR_CAP);
}
```

**`score.ts` must consume these, not keep a copy.** Rewrite all **three** call sites — `:165`
(preference mismatch), `:231` (resume), `:232` (job) — and delete the private function. This is
the load-bearing part: it makes drift between the score's vector and the stored vector
structurally impossible.

**`constants.ts`** gains:

```ts
export const EMBEDDING_MODEL_ID = 'Xenova/jina-embeddings-v2-small-en';
export const EMBEDDING_DIMENSIONS = 512;
/** Bump on ANY change to model id/revision/dtype/pooling, EMBEDDING_CHAR_CAP,
 *  EMBEDDING_MAX_LENGTH, sanitizeForEmbedding(), or the job-input template.
 *  Vectors tagged with an older value are ignored, never compared. */
export const EMBEDDING_VERSION = 'jina-v2-small-en.q8.mean-norm.cap6000.v1';
```

Point `worker.ts`'s `DEFAULT_MODEL_ID` at `EMBEDDING_MODEL_ID` so the id has one definition site.
Re-export the builders from `index.ts` (a **named export on `.`**, not a subpath — these are pure
string functions with no deps, exactly like `extractTerms`; `./node-embedder` and `./worker` are
subpaths only because they pull heavy environment-specific deps).

Bump `packages/scoring` `1.1.0 → 1.2.0` (additive/minor). **No npm publish needed** — `apps/ui`
compiles from source via tsconfig paths, `apps/web` from the symlinked dist. Update the package
README; these are published API now.

*Verify:* `npm --prefix packages/scoring test` — existing `score.test.ts` must pass **unmodified**.

---

## Phase B — infra

`apps/web/docker-compose.yml`:
- image `postgres:17-alpine` → **`pgvector/pgvector:pg18`**
- volume `resurank-pgdata:/var/lib/postgresql/data` → **`:/var/lib/postgresql`**

The second change is mandatory and easy to miss: the official `postgres:18` image sets
`ENV PGDATA /var/lib/postgresql/18/docker` and `VOLUME /var/lib/postgresql`. Mounting the old
path yields a container that appears to work and silently drops its data on recreate. Leave a
comment saying so, or the next person will "fix" it back.

```bash
docker compose -f apps/web/docker-compose.yml down -v && npm --prefix apps/web run db:up
```

*Verify:* `select version();` reports 18.x; `select * from pg_available_extensions where
name='vector';` returns a row; `docker compose restart postgres` then `\dt` still shows tables
(proves the volume path).

---

## Phase C — schema + migration

Two nullable columns on `scoreHistory` (`apps/web/src/db/schema.ts:139`), using
`vector` from `drizzle-orm/pg-core` and `EMBEDDING_DIMENSIONS` from `@resurank/scoring`:

```ts
jobVector: vector('job_vector', {dimensions: EMBEDDING_DIMENSIONS}),
jobVectorVersion: text('job_vector_version'),
```

Nullable by design — history saving is best-effort and must survive an embedding failure.
`jobVectorVersion` is plain `text()`, deliberately **not** the file's `as const` tuple +
`$type<T>()` enum convention: the set of versions is open-ended and historical.

Plus a check constraint making "vectored" one boolean fact at the storage layer:

```ts
check('score_history_vector_versioned',
  sql`(${table.jobVector} is null) = (${table.jobVectorVersion} is null)`)
```

**No HNSW index.** Record the future one as a comment next to the column, including the two
things that are easy to get wrong: `vector_cosine_ops` is required or `<=>` silently seq-scans
past the index, and `hnsw.iterative_scan='relaxed_order'` is needed so the `user_id` filter
cannot under-return.

`npm --prefix apps/web run db:generate` produces `0002_*.sql`. **Hand-prepend** the extension —
drizzle-kit will not emit it, and the `vector(512)` type does not exist until it runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "score_history" ADD COLUMN "job_vector" vector(512);
```

Both in the same file: drizzle's migrator runs each file in one transaction and `CREATE
EXTENSION` is transactional. Hash mismatch is not a concern — `drizzle-orm`'s migrator compares
`folderMillis` from `meta/_journal.json` against `__drizzle_migrations`, it does not re-verify
hashes. Add a warning comment above the columns in `schema.ts` so nobody regenerates 0002 blind.
Eyeball whether drizzle-kit 0.30.6 emitted the `check()`; add it by hand if not.

Apply with the **production** path, not `drizzle-kit migrate`:

```bash
npm run build:scoring && npm --prefix apps/web run build && node apps/web/dist/db/migrate.js
```

*Verify:* `\d score_history`; `select '[1,0]'::vector <=> '[0,1]'::vector;` returns 1.

---

## Phase D — server route

`apps/web/src/lib/domain.ts` — `ApiHistorySimilar extends ApiHistorySummary { similarity: number }`.

`apps/web/src/lib/validation.ts` (**zod v3** — the Dockerfile preserves the nested zod3 copy):
- `similarQuerySchema` = `{limit: coerce.number().int().min(1).max(25).default(10)}`
- extend `createHistorySchema` with `jobVector: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS).optional()`
  and `jobVectorVersion: z.string().min(1).max(120).optional()`, plus a `.refine()` that they
  arrive together. `.finite()` matters: NaN/Infinity would be a pgvector insert error that takes
  the whole history row down.

`apps/web/src/routes/history.ts` — new `GET /api/history/:id/similar`, `preHandler: requireAuth`,
**no rate-limit override** (matches the other two history GETs; note in a comment that this is
the only O(n) vector-math route, so a dedicated `searchLimit` in `route-options.ts` is the place
to add one later — do not reuse `writeLimit`, the name would lie).

Shape:
1. Fetch the source row's vector+version scoped by `and(eq(id), eq(userId))` — ownership in the
   WHERE, so a non-owned id is indistinguishable from a nonexistent one. 404 otherwise.
2. If `!vector || version !== EMBEDDING_VERSION` → **200** `{similar: [], unavailable: 'no_vector'}`.
   This is a state, not a failure; no new `ErrorCode` (the union in `errors.ts` is deliberately closed).
3. kNN:

```ts
const queryVector = sql`${JSON.stringify(source.vector)}::vector`;
const distance = sql`${scoreHistory.jobVector} <=> ${queryVector}`;
db.select({...summaryColumns, similarity: sql<number>`greatest(0, 1 - (${distance}))`.mapWith(Number)})
  .from(scoreHistory)
  .where(and(
    eq(scoreHistory.userId, userId),          // ← security-critical
    ne(scoreHistory.id, id),                  // ← else the top hit is always itself
    isNotNull(scoreHistory.jobVector),
    eq(scoreHistory.jobVectorVersion, EMBEDDING_VERSION),
  ))
  .orderBy(distance).limit(take);
```

`<=>` is cosine **distance** in [0,2], not similarity — inverting it yields a plausible but
reversed ranking. `greatest(0, …)` clamps the rare negative cosine.

Duplicate JDs (same job scored against three resumes) land at distance ~0 and are **kept** — "you
scored this exact job against your other two resumes, at 71% and 44%" is the most useful thing
this feature can say, and the row sub-line already disambiguates by filename and date.

Also narrow `POST /api/history`'s unqualified `.returning()` to the columns actually used, or
every insert now drags 512 floats back for nothing.

---

## Phase E — tests

Extend the existing `describe('history')` and cross-tenant blocks in `apps/web/test/domain.test.ts`
(node:test, serial, real Postgres — no new suite). Local helper:

```ts
/** Unit vector at `radians` in the (e0,e1) plane: cosine between two of these
 *  is exactly cos(θ1−θ2), so similarity is checkable to fp precision. */
function planeVector(radians: number): number[] { /* 512 zeros, [0]=cos, [1]=sin */ }
```

Cases: exact `similarity` to 1e-6 (pins the `1 - (<=>)` conversion); query row excluded;
**vectors at 0°/30°/80° return in descending similarity** (the only thing that catches an
inverted `<=>`); row without a vector absent; row with `'bogus-v0'` version absent; query entry
without a vector → 200 `unavailable: 'no_vector'`; length-511 → 400; vector without version → 400;
`null`/Infinity in the array → 400 not 500; `limit` honoured and defaulted; and the one that
matters most — **Bob POSTs a row whose vector is byte-identical to Alice's, and Alice's `/similar`
still returns only her own rows** (dropping `userId` from the kNN WHERE passes every other test).

Plus one unit test in `packages/scoring`: `buildJobEmbeddingInput` against an exact expected
string, so a future edit to the sanitizer or the `". "` join is a loud failure rather than a
silent vector-invalidation.

Test infra: the pgvector image is a hard prerequisite (without it every new test dies on
`type "vector" does not exist`), and the harness has no migration reset — note in
`apps/web/README.md` that `node apps/web/dist/db/migrate.js` must run first. Teardown is
unchanged; vectors ride along on `score_history` rows via the existing FK cascade.

Expect ~66 → ~78 tests, still 17 suites.

---

## Phase F — client data path

`HistoryEntryInput` (`apps/ui/src/app/shared/storage/storage-adapter.ts:49`) gains **optional**
`jobVector?: number[]` and `jobVectorVersion?: string`. Optional is what keeps
`ElectronStorageAdapter.saveHistoryEntry` valid with **zero edits** — desktop is untouched by
this entire feature. `HttpStorageAdapter.saveHistoryEntry` forwards both;
`JSON.stringify` drops `undefined` keys.

`ApiService.match()` (`apps/ui/src/app/shared/api.service.ts:70`) computes the vector after
scoring — in **its own try/catch, separate from the existing save try/catch**. Folding it into
the existing one would let an embedding failure (or the worker's 60s timeout) destroy the history
row, a regression for the sake of an optional field.

```ts
let jobVector: number[] | undefined;
try {
  jobVector = await this.embedding.embedJob(buildJobEmbeddingInput({title, description}));
} catch { /* best-effort: losing the vector must not cost the history row */ }
```

`scoreResumeAgainstJob` embedded this exact string one call earlier, so the `WorkerEmbedder` LRU
(`textCache`, size 16, keyed on exact text) returns it with **zero extra inference** — but only
because the same raw `{title, description}` is passed. Passing `title.trim() || 'Untitled role'`
would miss the cache *and* store a vector for text the score never saw. Add a doc comment on
`EmbeddingService.embedJob` (currently dead code, about to become live) saying it takes the
output of `buildJobEmbeddingInput` and nothing else.

`apps/ui/src/app/web/history.service.ts` gains `ApiHistorySimilar`, `SimilarResponse`, and
`similar(id, limit = 10)` following the existing unwrap-a-named-key convention.

---

## Phase G — UI

**Attach point: the modal footer.** `ModalShellComponent` already has an
`<ng-content select="[modal-footer]"/>` slot that is fully styled in
`modal-shell.component.css:92` (flex, right-aligned, top border, `--surface-2`) and has never
been used. The list row's `→` `.icon-btn` is rejected — it sits inside an `<article>` whose whole
surface is `(click)="open(...)"`, so a second action means `stopPropagation()` and two competing
meanings in one row.

`HistoryDetailModalComponent` **stays presentational** (it injects nothing today; preserve that).
It gains inputs `similar`, `similarLoading`, `similarUnavailable`, `similarRequested` and outputs
`findSimilar` / `openSimilar`. `HistoryComponent` owns the state and the fetch, matching the
existing smart/dumb split.

Footer button uses **`.primary`** (there is no `.btn` in this codebase; `.primary` already handles
`:disabled`). The results list reuses `.hist-list`/`.hist-item`/`.ring.sm`/`.hist-meta`/`.chip` —
**all already global in `apps/ui/src/styles.css`, so no new CSS, no `styleUrl`, no hardcoded
colors.** Each row shows the entry's score ring, title, `filename · date`, and a
`{{ pct }}% similar` chip.

The one design hazard is two different percentages per row (match score vs. similarity).
Mitigated by the explicit "% similar" label plus a muted caption — *"Ranked by how close the job
description is to this one — not by your match score."* If it still reads badly, drop the ring
from these rows.

Clicking a result calls the existing `HistoryComponent.open(id)`, so the modal swaps subject in
place — a browsable chain with no router work. **`open()` must reset the similar-state signals**
or stale results linger under the new entry.

---

## Phase H — docs

- **`docs/deployment-runbook.md`** — most important. §1 line 15-16 currently says *"Any recent
  Postgres version — nothing here uses exotic extensions"*, which becomes false. Replace with the
  pgvector requirement, a role permitted to `CREATE EXTENSION`, and a pre-deploy check
  (`select * from pg_available_extensions where name='vector';`) — because otherwise the failure
  lands at migration time, *after* the image is rolled. Note 0002 is hand-edited; add a rollback
  note (dropping the two columns is safe, leave the extension).
- **`apps/web/README.md` + root `README.md`** — "performs no ML" needs precision, not just
  technical defensibility: *the server runs no ML; it stores vectors the client computed and does
  arithmetic over numbers it never produced. The ONNX tree is still pruned and the build still
  fails if `apps/web/src` imports `@resurank/scoring/node-embedder`.*
- **`CLAUDE.md`** — highest-leverage line in the change: changing `EMBEDDING_MODEL_ID`, the model
  revision, `EMBEDDING_CHAR_CAP`, `EMBEDDING_MAX_LENGTH`, `sanitizeForEmbedding`, or the job-input
  template **requires bumping `EMBEDDING_VERSION`**.
- **`docs/semantic-search-context.md`** — do not delete; it is the only record of what was
  *rejected*. Convert to a design record: mark questions 2/3/4/5 decided (noting honestly that
  its own bytea recommendation was overruled, and why), 7 half-decided, and move 1 (cosine vs.
  real score) and 6 (desktop parity) to "Still open."
- `graphify update .`

---

## Verification

```bash
npm --prefix packages/scoring test                    # Phase A — existing tests must pass unchanged
npm --prefix apps/web run build && npm --prefix apps/web run test   # Phases C–E, ~78 tests
npm --prefix apps/ui run build:web                    # Phase F
```

End-to-end (Phase G): `npm run dev:frontend:web`, sign in, score two closely-related JDs, one
unrelated, and one JD twice against different resumes. Open one → **Find similar saved jobs**:
- the related JD ranks above the unrelated one;
- the duplicate shows ~100% with its own resume filename;
- clicking a result swaps the modal and shows an empty similar-list;
- Network shows exactly one `/similar` GET;
- **no new worker inference fires on the second score** — that's the LRU hit. If one does, the
  wrong title string was passed.

## Risks

| Risk | Why it bites |
|---|---|
| `title.trim() \|\| 'Untitled role'` passed to `buildJobEmbeddingInput` | Highest-probability bug. Everything still works; you just pay a second inference and store a vector for text the score never saw. Completely silent |
| pg18 PGDATA/volume path | Old mount gives a container that works and drops data on recreate |
| `CREATE EXTENSION` privilege in production | The citext objection, escalated. Fails *after* the image rolls. Hence the pre-deploy check |
| 0002 regenerated blind | The extension line vanishes; next fresh deploy dies on `type "vector" does not exist` |
| `<=>` inversion | Reversed but plausible ranking. Only the 0°/30°/80° test catches it |
| `userId` missing from kNN WHERE | Cross-tenant title leak that passes every single-user test |
| Unpinned model revision in `worker.ts` | HF can serve different weights under the same id and `EMBEDDING_VERSION` would not change. Pre-existing; this feature makes it consequential. Follow-up: pin `revision` |
| Worker 60s timeout on the write path | If `embedJob` ever misses the LRU, `match()` blocks before returning. The split try/catch limits damage to "no vector," not the delay |
| Build-order asymmetry | `apps/ui` compiles scoring from **source** (tsconfig paths), `apps/web` from **dist** (symlink). `build:scoring` must precede `apps/web` build |

## Critical files

`packages/scoring/src/score.ts` · `packages/scoring/src/constants.ts` ·
`apps/web/src/db/schema.ts` · `apps/web/src/routes/history.ts` · `apps/web/src/lib/validation.ts` ·
`apps/web/docker-compose.yml` · `apps/ui/src/app/shared/api.service.ts` ·
`apps/ui/src/app/web/history/history-detail-modal.component.ts`
