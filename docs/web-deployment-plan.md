# Plan: Deploy ResuRank as a Node Web Server (multi-user, additive to the desktop app)

> **Path note (2026-07-25):** this document is kept as the original plan record.
> The server package has since moved from `packages/server` to **`apps/web`**,
> and the frontend from `frontend/` to **`apps/ui`** (`packages/` = published to
> npm, `apps/` = deployed). Every `packages/server/…` path below should be read
> as `apps/web/…`, and every `frontend/…` path as `apps/ui/…`. See
> [deployment-runbook.md](deployment-runbook.md) for current, operational paths.

> **Terminology:** "**server**" always means the new Node API process
> (`packages/server`) — there is exactly one. "**storage adapter**" means a
> frontend class implementing the shared `StorageAdapter` interface (a
> data-access layer) — there are two: one for desktop, one for web. These are
> different things; the words are not interchangeable.

## Context

ResuRank is currently an Electron + Angular desktop app where all data lives in
local JSON files and embedding/scoring runs entirely on-device. The goal is to
**additionally** offer ResuRank as a multi-user web service: users sign up, log
in, manage resumes and preferences stored in Postgres, and score resumes against
job descriptions through a browser UI.

**The Electron desktop app must remain standalone and fully functional.** The web
service is purely additive — nothing is removed from or broken in the desktop
build. The two ship in parallel from the same monorepo, sharing the common
packages (`scoring`, the Angular UI components, the embedding worker). The web
target is a **new server module (`packages/server`)** plus a **second build
configuration of the existing Angular frontend** that talks to that server
instead of Electron IPC.

The codebase is well-positioned for this because the heavy logic is already
decoupled:

- `packages/scoring` is framework-agnostic and runs in browser or Node.
- The browser embedder (`worker-embedder.ts` + `worker.ts`) already runs the
  model client-side in a Web Worker — no server inference needed.
- `frontend/src/app/api.service.ts` is already a REST-shaped façade. Components
  call `ApiService`, which delegates to `StorageService`. Today `StorageService`
  uses Electron IPC; we make it an **interface with two implementations**
  (Electron IPC vs HTTP) selected at build time — so `ApiService` and all UI
  components stay shared and unchanged.

The Electron layer (IPC in `src/main`/`src/preload`, local JSON files, Claude
Desktop integration, auto-update) is **left fully intact**. The web build simply
provides an alternative storage adapter and an auth layer that the desktop build
never loads.

### Confirmed decisions
- **Embeddings: client-side** (keep the existing browser worker). Server does
  **no ML** — it only persists data and handles auth. Preserves the privacy-first
  ethos, zero server inference cost, reuses existing code.
- **Auth: roll our own** — email/password, hashing, server-side sessions, email
  verification, forgot/reset.
- **Free v1** — no billing.
- **Data model: multiple resumes + scoring history per user.**
- **PDF stays client-side** (pdfjs already in the browser). Only extracted
  **text** is sent to and stored on the server (satisfies requirement #5 — the
  PDF binary never leaves the client). The desktop build keeps its existing
  PDF-buffer storage; only the web server omits it.
- **Desktop app: untouched and standalone.** No removal of Electron, IPC, local
  JSON, Claude Desktop, or auto-update.
- **One shared frontend, physically partitioned.** Web-only code lives in its own
  `web/` folder, desktop-only code in `desktop/`, and everything common in
  `shared/` (see "Frontend folder structure" below).

---

## Architecture

```
Browser (Angular, served as static)            Node server (new packages/server)
─────────────────────────────────────          ─────────────────────────────────
- pdfjs: parse PDF → text (client)              - Fastify HTTP API  (/api/*)
- Web Worker: embed + score (client)            - Auth (sessions, email verify/reset)
- HttpClient → /api/* (cookie session)          - CRUD over Postgres
- Auth UI, multi-resume UI, history UI          - Serves static Angular build
                                                - Transactional email (SMTP)
                                                       │
                                                  PostgreSQL
```

The server is essentially **auth + CRUD + email + static hosting**. No ONNX, no
Transformers.js on the server.

> ⚠️ **COOP/COEP gotcha:** the client-side embedding worker needs
> `crossOriginIsolated` (SharedArrayBuffer for threaded WASM). Electron supplies
> this today via `src/main/index.ts:271-272`, which sends
> `Cross-Origin-Opener-Policy: same-origin` + **`Cross-Origin-Embedder-Policy:
> credentialless`**.
>
> **`credentialless` is not supported in Safari.** Carrying the Electron headers
> over verbatim means Safari users lose `crossOriginIsolated`, and
> `packages/scoring/src/worker.ts` falls back to `numThreads = 1` — embedding
> still works, but single-threaded and noticeably slower. Two options:
> - **`require-corp`** — works in Safari, but every cross-origin asset then needs
>   a `Cross-Origin-Resource-Policy` header. Since all assets are same-origin
>   here, this is the better default for web.
> - **`credentialless`** — no CORP work, but degraded on Safari.
>
> Recommendation: use `require-corp` for the web build and verify
> `crossOriginIsolated === true` in Safari, Chrome, and Firefox.
>
> **UPDATE (Phase 7): "all assets are same-origin here" was wrong when this was
> written — the model was fetched from huggingface.co, which `require-corp`
> would have blocked outright (no CORP header on HF's CDN), not just degraded.
> Fixed by self-hosting; see "Model self-hosting" below. `require-corp` is now
> correct and live in `packages/server/src/app.ts`. Verified
> `window.crossOriginIsolated === true` in Chrome against the real built app.**

### Model self-hosting (Phase 7)

`packages/scoring/src/worker.ts` gained `modelHost`/`remotePathTemplate` config
(passed through `worker-embedder.ts`'s `WorkerEmbedderOptions`), applied to
transformers.js's `env.remoteHost`/`env.remotePathTemplate` only when set —
`undefined` by default, so the desktop build keeps fetching from the HF Hub
unchanged. `shared/model-host.token.ts` carries this through DI; only
`web/app.config.ts` provides a value.

`frontend/scripts/fetch-model.mjs` downloads the 5 files a q8-quantized
`Xenova/jina-embeddings-v2-small-en` pipeline needs (config, tokenizer,
tokenizer_config, special_tokens_map, vocab.txt, `onnx/model_quantized.onnx` —
~32MB) into `frontend/public/assets/models/`, gitignored, idempotent (skips
files already on disk). `npm run build:frontend:web` runs it before `ng build`;
the Dockerfile's build stage does the same.

**The bug that cost the most time here:** `MODEL_HOST` was originally set to
the bare path `/assets/models/`. Everything appeared to work — config.json and
the ONNX file fetched fine, `pipeline()` resolved without throwing — but
scoring failed at call time with `this.tokenizer is not a function`. Root
cause, several layers down: `get_pipeline_files` decides whether to load a
tokenizer at all by first *checking that one exists* via a Range-request probe
in `get_file_metadata`, and that probe validates the target with
`new URL(string)` — no base — before ever making the request. A bare path
isn't a valid absolute URL, so `new URL()` throws, the probe reports
"doesn't exist" (never actually hitting the network), transformers.js
concludes there's no tokenizer for this model, and `AutoTokenizer.from_pretrained`
is simply never called. The pipeline's own tokenizer property then defaults to
an inert placeholder object instead of a real tokenizer — no error at
construction time, only at first use. Fix: `MODEL_HOST` must be an absolute
URL (`${location.origin}/assets/models/`), matching the pattern already used
for `wasmPaths` a few lines above it. Confirmed by reproducing on a completely
fresh Chrome profile before and after the fix — this was not a caching
artifact.

---

## Server: new `packages/server`

Add `packages/server` to the root `package.json` `workspaces` array.

**Stack (new dependencies — require approval per CLAUDE.md "ask before adding"):**
- `fastify` + `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`,
  `@fastify/helmet` — HTTP, sessions cookie, throttling, static hosting, headers.
- `pg` + `drizzle-orm` + `drizzle-kit` — Postgres access, typed schema, migrations.
- `argon2` — password hashing.
- `zod` — request validation.
- `nodemailer` — transactional email over SMTP (pluggable provider: Resend/Postmark/SES).
- Reuse `@resurank/scoring` only for shared **types/constants** (e.g. char caps,
  `MatchResult` shape) — no runtime ML.

### Database schema (Drizzle migrations)
- `users` — `id`, `email` (unique, citext), `password_hash`, `name`,
  `email_verified` (bool), `active_resume_id`, `created_at`, `updated_at`.
- `sessions` — `id` (opaque token, hashed), `user_id`, `expires_at`,
  `created_at`, `user_agent`/`ip` (optional). Enables "log out everywhere."
- `email_tokens` — `id`, `user_id`, `token_hash`, `type` (`verify`|`reset`),
  `expires_at`, `used_at`. Single-use, short TTL.
- `resumes` — `id`, `user_id`, `filename`, `text`, `terms` (jsonb),
  `uploaded_at`. **Multiple per user.**
- `user_settings` — one row per user: `stopwords` (jsonb[]), `term_boosts`
  (jsonb), `missing_keyword_settings` (jsonb), `preference_mismatch_settings`
  (jsonb). Mirrors current global-per-user model; per-resume can come later.
- `score_history` — `id`, `user_id`, `resume_id`, `job_title`,
  `job_description`, `result` (jsonb = `MatchResult`), `created_at`.

Shapes mirror existing types in `frontend/src/app/storage.service.ts`
(`ResumeData`, `MissingKeywordSettings`, `PreferenceMismatchSettings`) and
`packages/scoring/src/types.ts` (`MatchResult`).

### REST endpoints
Auth & account:
- `POST /api/auth/register` → create user, send verification email.
- `GET  /api/auth/verify-email?token=…` → mark verified.
- `POST /api/auth/login` → set session cookie (httpOnly, secure, sameSite).
- `POST /api/auth/logout` (+ `/logout-all`).
- `POST /api/auth/forgot-password` → email reset link (requirement #7).
- `POST /api/auth/reset-password` → consume token, set new hash.
- `POST /api/auth/change-password` (authenticated).
- `GET  /api/users/me`, `PATCH /api/users/me` (update details, requirement #8).
- `GET  /api/auth/confirm-email-change?token=…` → completes an email change.
- `DELETE /api/users/me` (account deletion) + `GET /api/users/me/export` (data export).

**Email changes are two-step (decided during Phase 4).** `PATCH /api/users/me`
writes the requested address to `users.pending_email` and mails a `change_email`
token to it; the live `email` only moves once that link is clicked. Changing the
address immediately and re-verifying was rejected because a typo would lock the
account out permanently — login is blocked while unverified and password reset
would go to the wrong inbox. Because `pending_email` reserves nothing, the
`users_email_lower_unique` index is the backstop if the address is claimed
between the request and the click.

A password reset or change clears `pending_email` and revokes outstanding
`change_email` tokens: otherwise an attacker who queued a change from a stolen
session could still click their confirmation link after being locked out.

Domain (all scoped by session `user_id`, replacing the IPC channels in
`src/preload/index.cts`) — **implemented in Phase 5**:
- `GET/POST /api/resumes`, `GET/DELETE /api/resumes/:id`, `PUT /api/resumes/:id/active`.
  POST body is **extracted text + terms** (parsed client-side), never a PDF.
  Uploading sets the new resume active; deleting the active one promotes the
  next most recent (or leaves nothing active if it was the last).
- `GET /api/settings`, `PATCH /api/settings` (any subset of the four keys —
  **not** the bulk `PUT` originally sketched here: the desktop
  `StorageService` saves each key independently, and requiring a full resend
  to change one would open a lost-update race between two tabs).
- `GET/POST /api/history`, `GET /api/history/:id`, `DELETE /api/history/:id`.
  List rows are summaries (no `jobDescription`/`result`); the full
  `MatchResult` is fetched per-entry.
- `GET /api/bootstrap` (authenticated) → one round trip returning everything
  `StorageService.load()` needs: `resume` is the *active* resume in the exact
  `ResumeData` shape the shared getters expect, plus `resumes` (the full list),
  `stopwords`, `termBoosts`, `missingKeywordSettings`,
  `preferenceMismatchSettings`, and `user`. History is deliberately excluded —
  it is its own paginated screen, not part of the original snapshot.
- `GET /api/health`.

Cross-cutting: zod validation, rate-limit auth + write routes (`RATE_LIMIT_WRITE_MAX`/
`_WINDOW`, looser than the auth throttle — this is normal usage by an
already-authenticated caller), enforce the existing char caps
(`JOB_DESCRIPTION_CHAR_CAP`, `RESUME_CHAR_CAP` from `packages/scoring`) as a
`413 payload_too_large`, structured error responses. Every lookup by id filters
on `user_id` and returns `404` (never `403`) for another user's row — telling a
caller "that exists but isn't yours" is itself a disclosure.

**Concurrency note.** The one-active-resume-per-user invariant is enforced by a
partial unique index, but the "clear the current active row" `UPDATE` can only
lock rows that already exist — two concurrent *first* uploads on a fresh
account both find nothing to clear and both try to insert an active row, so one
would 500 on the index. Every write path that touches the active flag
(`lockUserForResumeWrite` in `packages/server/src/lib/domain.ts`) takes a
`SELECT … FOR UPDATE` on the user's own row first, giving all of them something
to queue on regardless of whether a resume row exists yet.

---

## Frontend: one shared app, two storage adapters, physically partitioned

The existing Angular app is reused for both targets. Changes are **additive and
behind a build switch**; the Electron build keeps its current behavior.

### Frontend folder structure

Web-only code is kept **physically separate** from desktop code. Common code
depends only on the shared contract; `desktop/` and `web/` never import each
other, and `shared/` never imports either of them.

```
frontend/src/app/
├── shared/            # used by BOTH builds — the bulk of the app
│   ├── app.component.ts
│   ├── api.service.ts
│   ├── matcher.service.ts
│   ├── embedding.service.ts        # + embedding worker
│   ├── resume-parser.service.ts
│   ├── settings-drawer/ stopwords-modal/ …   (all UI components)
│   └── storage/
│       └── storage-adapter.ts      # the interface + DI token (shared contract)
│
├── desktop/           # Electron build ONLY — never imported by web
│   ├── electron-storage.adapter.ts # current window.electronAPI code, verbatim
│   ├── claude-desktop.service.ts
│   └── electron-api.d.ts
│
└── web/               # Web build ONLY — never imported by desktop
    ├── http-storage.adapter.ts     # HttpClient impl (withCredentials)
    ├── auth/                        # login, register, verify, forgot, reset
    ├── account/                    # update details, delete/export, change pw
    ├── resumes/                    # multi-resume list/picker
    ├── history/                    # scoring history
    └── interceptors/ guards/
```

**Boundary enforcement (so the separation is a guarantee, not just tidy):**
- Dependencies point inward only: `desktop/ → shared/`, `web/ → shared/`.
- `shared/` never imports `desktop/` or `web/`; `desktop/` and `web/` never
  import each other.
- Each build wires its storage adapter via the DI token in its own
  `environment.ts` / bootstrap, so tree-shaking drops the other folder entirely —
  no Electron code ships in the web bundle and vice-versa.
- Add an ESLint `no-restricted-imports` / `import/no-restricted-paths` rule that
  fails the build if these boundaries are crossed.

### Three details the interface must get right

Verified against `frontend/src/app/storage.service.ts`:

1. **`getUserDataPath()` must not be on the shared interface.** It exists only to
   build an Electron model-cache dir (`embedding.service.ts:59`) and is
   meaningless on the web. Putting it on `StorageAdapter` leaks a desktop concern
   into the shared contract and forces the HTTP adapter to stub it. Instead
   expose an optional `modelCacheDir?(): Promise<string | undefined>`, or move
   the cache-dir decision out of `EmbeddingService` and inject it as a config
   value per build. **`EmbeddingService` currently depends on `StorageService`
   solely for this** — breaking that coupling is what lets `EmbeddingService`
   live cleanly in `shared/`.

2. **`load()` is a bulk snapshot; the web needs a bootstrap endpoint.** Every
   getter funnels through `load()`, which calls `window.electronAPI.storeRead()`
   once and caches the whole `StoreSnapshot`. The HTTP adapter should mirror this
   with a single `GET /api/bootstrap` returning the same shape, rather than one
   request per getter — otherwise app start becomes 5 round-trips.

3. **The in-memory cache never expires — that is a real bug risk on the web.**
   `this.cache` is populated once and only mutated by local writes. On desktop
   (single window, single process) that is safe. In a browser with two tabs open,
   tab A's writes leave tab B permanently stale. The HTTP adapter needs an
   explicit invalidation story: refetch on window focus, a short TTL, or
   optimistic-update-plus-revalidate. Do not port the cache semantics verbatim.

### Changes
1. **Abstract the storage adapter — DONE in Phase 6.** Extracted `StorageAdapter`
   (in `shared/storage/storage-adapter.ts`) from the old `StorageService` — same
   method names/signatures, minus `getUserDataPath()` (see point 2). Provided via
   the `STORAGE_ADAPTER` injection token, wired in each build's own
   `app.config.ts` rather than an Angular build-configuration/`environment.ts`
   switch (there's only one build target until Phase 7 adds `web`):
   - `ElectronStorageAdapter` (`desktop/electron-storage.adapter.ts`) — the
     **verbatim** old implementation (`window.electronAPI`), wired as the sole
     `STORAGE_ADAPTER` in `desktop/app.config.ts`. No behavior change — verified
     against the real Electron app (see Verification below).
   - `HttpStorageAdapter` (`web/http-storage.adapter.ts`) — **DONE in Phase 7.**
     `load()` calls `GET /api/bootstrap` once and caches the snapshot, same
     shape as `ElectronStorageAdapter`. Cache invalidation (finding #3): clears
     on `window` `focus`, so switching back to a stale tab re-fetches. Caches
     the **in-flight promise**, not just the resolved value — `AppComponent.
     ngOnInit` fires five getters (resume, stopwords, term boosts, two
     settings blocks) back-to-back before any can resolve, and without this a
     null-cache check alone lets all five race past it and issue five separate
     `/api/bootstrap` calls per page load. Verified: confirmed 5 calls without
     the fix, 1 with it.
   `ApiService` and all UI components depend only on the interface, unchanged
   apart from the import path and the DI token in place of a concrete class.

   Two more Electron-only capabilities `shared/` components used directly
   (`window.electronAPI.writeToClipboard` in the stopwords modal,
   `window.electronAPI.getAppVersion()` in the settings drawer) got the same
   treatment as `getUserDataPath()` below — small tokens
   (`CLIPBOARD_WRITER`, `APP_VERSION`) with a browser-safe default and a
   desktop override, so `shared/` never references `window.electronAPI` at all.
   Without this, the ESLint boundary rule below would only catch `import`
   statements, not a global `shared/` silently depended on — a real dependency
   the rule couldn't see.

   The Claude Desktop integration card has no web equivalent (it's an Electron
   main-process feature), but `SettingsDrawerComponent` — which the plan places
   in `shared/` — renders it. Resolved with an optional
   `DESKTOP_SETTINGS_PANEL` token holding a component type (`null` on any build
   that doesn't provide one) and Angular's `NgComponentOutlet`, so `shared/`
   never imports the desktop-only `ClaudeDesktopCardComponent` directly.

   **Boundary enforcement — DONE, but via ESLint, not `import/no-restricted-paths`
   alone as a hand-rolled config.** `frontend/eslint.config.mjs` uses
   `eslint-plugin-import`'s `import/no-restricted-paths` with zones forbidding
   `shared/ ↔ desktop/`, `shared/ ↔ web/`, and `desktop/ ↔ web/` in both
   directions. Verified to actually fire (not just parse cleanly) by injecting
   a real cross-boundary import and confirming `npm run lint` rejects it, in
   both directions, before removing the test file. New devDependencies:
   `eslint@^9` (pinned — `eslint-plugin-import@2.32` declares peer support only
   through ESLint 9, not the 10.x that installs by default today),
   `typescript-eslint`, `eslint-plugin-import`.
2. **Embedding/scoring unchanged in both — DONE in Phase 6.** `embedding.service.ts`
   moved to `shared/` and no longer depends on `StorageService` at all — the one
   thing it needed (a model-cache directory) now comes from a `MODEL_CACHE_DIR`
   token: `shared/`'s default resolves to `undefined` (browser/IndexedDB cache),
   and `desktop/app.config.ts` overrides it with the same
   `window.electronAPI.getUserDataPath().then(p => \`${p}/model-cache\`)` call
   the old code made directly. This is what let `EmbeddingService` — and
   therefore `ApiService`, which depends on it — move into `shared/` at all.
   Verified live: uploaded a real PDF and ran a scoring match through the
   rebuilt desktop app; the embedding worker loaded and produced a score
   identical in shape to before the refactor (68%, embedding/TF-IDF breakdown,
   matched/missing terms).
3. **Auth UI + routing (web build only, in `web/`) — DONE in Phase 7,
   account-settings screen excepted (Phase 9).** Login, register, verify-email,
   forgot-password and reset-password components, each backed by
   `web/auth.service.ts` (wraps `/api/auth/*`). `web/auth.guard.ts` gates the
   single `''` route, which renders `shared/app.component.ts` completely
   unchanged — Phase 9 still owns multi-resume nav, so signing in lands on the
   same single-resume Score view the desktop build has always had.
   `web/auth.interceptor.ts` catches 401s, but **only** on the error code
   `unauthenticated` — a wrong password on the already-authenticated
   change-password form is also a 401 (`invalid_credentials`), and redirecting
   on *that* would yank a signed-in user to `/login` for typing their old
   password wrong. `web/app-shell.component.ts` is the new bootstrap root
   (`main.web.ts`), same `app-root` selector as `shared/app.component.ts` so
   `index.html` needs no changes — it also has to set `data-theme` itself,
   since the auth screens render before `AppComponent` (which normally owns
   that) ever mounts; without it every themed CSS variable resolves to
   nothing and the screen renders unstyled.

   **Build wiring — DONE, via Angular configuration composition, not a
   standalone `web` config carrying its own optimization settings.**
   `angular.json`'s `web`/`web-development` configurations hold only a
   `fileReplacements` swap (`main.ts` → `main.web.ts`); `npm run build:web` /
   `start:web` invoke `ng build/serve --configuration production,web` /
   `development,web-development` so the web build inherits `production`'s
   `optimization.styles.inlineCritical: false` for free. That setting is not
   cosmetic: Angular's default (`inlineCritical: true`) emits
   `<link ... media="print" onload="this.media='all'">` to defer non-critical
   CSS, and Helmet's default CSP includes `script-src-attr 'none'`, which
   blocks that inline `onload` attribute outright — the page loaded but
   rendered fully unstyled until this was caught. `production`'s setting
   avoids the pattern entirely instead of adding a CSP exception for it.
4. **Multi-resume + history UI (in `web/`, additive) — DONE in Phase 9.**
   `StorageAdapter` gained one new method, `saveHistoryEntry()`: `HttpStorageAdapter`
   posts to `/api/history` (against whichever resume its own `activeResumeId`
   currently points at), `ElectronStorageAdapter` no-ops. `ApiService.match()`
   calls it after scoring, awaited but wrapped in try/catch — a history-write
   failure must never hide a score the user is already looking at. The
   Job description form's title is optional in the UI but `createHistorySchema`
   requires a non-empty `jobTitle`; `match()` falls back to `'Untitled role'`
   rather than loosening the server schema for a UI nicety.

   Resume list/picker turned out to need real interaction with the shared
   Score screen (switching the active resume has to make `AppComponent` show
   the new one), which the existing `DESKTOP_SETTINGS_PANEL`-style token
   pattern doesn't support out of the box (`NgComponentOutlet` has no output
   binding). Solved with `ngComponentOutletInputs`: `RESUME_PICKER_PANEL`
   (`shared/resume-picker-panel.token.ts`, same null-by-default shape as
   `DESKTOP_SETTINGS_PANEL` but web-only instead of desktop-only) renders
   `web/resume-picker/resume-picker.component.ts` inside a new `.panel-head`
   wrapper around the "Job description" title; `AppComponent` passes its own
   `reloadResume` as an `onSwitched` input (an arrow class field, not a
   method, so the reference stays bound to `this` after being handed to a
   dynamically-created component). The picker itself, and the full Resumes
   screen, inject the concrete `HttpStorageAdapter` class directly (not the
   `STORAGE_ADAPTER` token) for a `setActiveResume()` method that updates the
   cached snapshot in place — multi-resume switching has no desktop
   equivalent, so it isn't on the shared interface. This needed
   `web/app.config.ts` to provide `HttpStorageAdapter` under **both** its own
   class and the `STORAGE_ADAPTER` token via `useExisting`, so both injection
   paths share one instance — `useClass` alone only registers it under the
   token, and a second untracked instance would have split the cache/
   `activeResumeId` state invisibly. Caught in review before the first build,
   not by a failing test.

   Navigation is a new `web/nav-shell.component.ts` (brand, Resumes/Score/
   History nav, avatar menu with Account/sign-out/sign-out-everywhere)
   wrapping the four authenticated screens as router children — `AppComponent`
   (Score) renders inside it completely unchanged apart from the resume-picker
   outlet above. The Phase 8 min-width guard moved from `shared/app.component.
   css` into this new shell, since it now needs to cover Resumes/History/
   Account too, not just Score; unlike Phase 8's version it needs no
   `data-platform` gating; `nav-shell.component.ts` only ever exists in the
   web bundle.

   Three deliberate mockup deviations, each because the server doesn't (and
   wasn't asked to) support the mockup's exact affordance: the Resumes screen
   has no rename (✎) button — there is no `PATCH /api/resumes/:id` — only
   delete (two-click confirm, no `window.confirm`) and make-active; History's
   "Highest score" sort is done client-side on the loaded page, since
   `historyQuerySchema` only orders by date; and History's list rows show
   resume + date only, not "N matched, M missing" — the summary columns
   (`routes/history.ts`) deliberately omit the full `MatchResult`, so those
   counts are only available once you open an entry's detail modal
   (`web/history/history-detail-modal.component.ts`, built on the existing
   `ModalShellComponent`).

   Verified live end-to-end via raw CDP against the real server/Postgres/
   Mailpit (the Chrome extension driver wasn't connected this session):
   register → verify → login → nav renders on all 4 screens → upload two
   distinctly-named resumes (`DOM.setFileInputFiles` on the real file input,
   not a synthetic File) → resume-B auto-activates → switch to resume-A via
   the Score screen's picker, confirmed via the settings drawer → run a real
   match → history shows the new entry, detail modal renders the full job
   description and breakdown → two-click delete removes resume-B and the
   server promotes resume-A to active, reflected in the UI without a reload →
   Account profile update reflects immediately in the avatar's initials → a
   wrong current password on the change-password form shows an inline error
   **without** redirecting to `/login` (re-confirms the Phase 7
   `invalid_credentials`-vs-`unauthenticated` interceptor distinction, this
   time through a real UI path instead of a direct API call) → export
   actually downloads a JSON archive (`Page.setDownloadBehavior` + inspecting
   the file) containing the right resume/history counts → sign-out-everywhere
   redirects to `/login`. Also re-verified the min-width guard behaviorally
   (not just by reading the CSS) on both Score and Resumes at 700px vs
   1280px, since it moved components this phase. Desktop: rebuilt, bundle
   diffed the same way as Phase 8 (no web-only code, `data-platform` never
   set, original `overflow:hidden` byte-identical), and additionally launched
   live this time (`electron-forge start -- --remote-debugging-port=...`)
   given this phase touched shared `AppComponent` itself, not just CSS —
   confirmed the resume-picker outlet renders nothing, the existing local
   resume/settings still load, and the screen is visually unchanged.
5. **No Electron code removed — DONE in Phase 6.** `claude-desktop.service.ts`,
   `claude-desktop-card/`, and `electron-api.d.ts` already live in `desktop/`
   (moved with `git mv`, history preserved) and `window.electronAPI` appears
   nowhere under `shared/` — grepped and confirmed. `shared/clipboard.token.ts`'s
   default is `navigator.clipboard.writeText`, ready for `web/` to use as-is in
   Phase 7; `desktop/app.config.ts` overrides it back to
   `window.electronAPI.writeToClipboard` for the reason noted inline: the
   renderer denies all permission prompts, so the main-process round trip is
   what avoids one.

> Build wiring: add a `web` Angular build configuration (or a separate target)
> that swaps the `environment.ts` provider set and route table. The existing
> default build remains the Electron build, byte-compatible with today's
> `npm run build:frontend`.

---

## What is shared vs. web-only (nothing is removed)

- **Untouched / desktop stays standalone:** Electron `src/main` + `src/preload`,
  `forge.config.cjs`, auto-update, Claude Desktop MCP integration, local JSON
  storage. The desktop build keeps working exactly as today.
- **Shared (`frontend/src/app/shared/`):** `packages/scoring`, the embedding
  worker, the Angular UI components, `ApiService`, and the `StorageAdapter`
  interface.
- **Web-only (new):** `packages/server` (the server), `frontend/src/app/web/`
  (`HttpStorageAdapter`, auth UI/routes, multi-resume + history), and the `web`
  frontend build configuration.
- **Desktop-only:** `frontend/src/app/desktop/` (`ElectronStorageAdapter`,
  Claude Desktop service, `electron-api.d.ts`).
- `packages/scoring` and `packages/mcp-server` are untouched.

---

## UI changes for web

Mockup: [`docs/ui-mockup-web.html`](./ui-mockup-web.html) — open in a browser, use
the top bar to switch screens, and resize to see the responsive behavior. It uses
the exact tokens from `frontend/src/styles.css`.

### Findings from the current UI

The desktop UI is a **single screen with no navigation and no responsive rules**.
Three concrete blockers, all verified in the code:

1. **The viewport is locked — DONE in Phase 8.** `frontend/src/styles.css` sets
   `html,body{height:100%;overflow:hidden}` and `app.component.css:5-6` sets
   `:host{height:100vh;overflow:hidden}`. On the web this means the page cannot
   scroll — content past the fold is unreachable. Must become `min-height` with
   normal document scrolling for the web build.
   Fixed by scoping, not editing in place: both files are compiled into *both*
   bundles (`app.component.ts` is `shared/`, `styles.css` is one global
   stylesheet listed once in `angular.json`), so the desktop rules above are
   untouched and a new override is added next to them, gated on an attribute
   only the web build ever sets. `AppShellComponent` (`web/app-shell.component.ts`)
   stamps `document.documentElement.setAttribute('data-platform', 'web')` in
   its constructor, alongside the existing one-time `data-theme` read from
   Phase 7. `styles.css` then overrides `html,body` for
   `html[data-platform="web"]`; `app.component.css` overrides `:host`/`.shell`/
   `.body`/`.content` via `:host-context([data-platform="web"])` (Angular's
   mechanism for styling a component based on an ancestor outside itself).
   Desktop never sets the attribute, so none of it ever matches — confirmed by
   diffing the compiled desktop bundle before/after: the original
   `html,body{overflow:hidden}` rule is byte-identical, `AppShellComponent`
   doesn't ship in the desktop bundle at all, and no desktop code ever calls
   `setAttribute('data-platform', …)`. The `:host-context` CSS itself *does*
   ship in the desktop bundle (inert) because `app.component.ts` is shared —
   same tradeoff Phase 7 already made for the auth-only global CSS classes.
   Also added a **min-width guard**: this layout has zero media queries and a
   hard-coded 320px settings drawer (finding #2 below, still open for real
   responsive work), so below 860px — the same breakpoint the Phase 7 auth
   screens already use — `.shell` is swapped for a one-line "widen your
   browser" message instead of shipping a silently broken layout. The guard
   markup lives in the shared `app.component.html` (always in the DOM,
   `display:none` by default) so it stays out of the web-only `web/` folder
   without touching desktop behavior, same scoping mechanism as above.
   Verified live: registered/verified/logged in against the real server +
   Postgres + Mailpit, drove real Chrome via raw CDP (`Emulation.setDeviceMetricsOverride`)
   — at 1280px the shell renders and `getComputedStyle(html).overflow` is
   `visible`; forcing 2000px of content and calling `scrollTo` actually moves
   `window.scrollY` (would have been inert under the old `overflow:hidden`);
   at 700px the shell is `display:none` and the guard renders with the correct
   copy. Desktop bundle rebuilt and diffed as above (not re-launched live this
   time — the byte-level bundle diff plus the deterministic nature of CSS
   attribute scoping was judged sufficient; flag if a full live Electron pass
   is wanted too).
2. **Zero media queries.** `grep -c "@media"` returns **0** across
   `app.component.css` (631 lines) and `styles.css`. The layout is fixed-desktop:
   the settings drawer is a hard `width:320px` fixed panel. Every screen needs
   responsive rules — this is net-new work the phased plan must budget for.
3. **No router and no HttpClient.** `app.config.ts` provides only
   `provideZoneChangeDetection` — there is no `provideRouter` and no
   `provideHttpClient` anywhere. Auth screens are not "just more routes"; routing
   is a net-new architectural addition for the web build.

Also `-webkit-app-region: drag` on `.toolbar` is Electron-only — harmless on the
web but should be scoped to the desktop build.

### Proposed screens

| Screen | Status | Notes |
|---|---|---|
| **Sign in / Register / Forgot** | DONE — Phase 7 | Split layout; brand panel collapses below 860px. Leads with the privacy story — the PDF never leaves the device. |
| **Resumes** | DONE — Phase 9 | Card list with an *Active* badge and drop zone. No rename — the server has no `PATCH /api/resumes/:id` — delete only (two-click confirm, no `window.confirm`). Copy states plainly that only extracted text is uploaded. |
| **Score** | DONE — Phase 9 | Same panels and score ring, `shared/app.component.ts` unchanged. **Adds a "Scoring against" resume picker** via `RESUME_PICKER_PANEL` — desktop never needed one because there was only ever one resume, and the picker is entirely absent (not just hidden) from the desktop bundle. |
| **History** | DONE — Phase 9 | Reuses the score-ring motif at `--size:44px` (mapped through the same poor/fair/good/great tiers as the Score screen's own ring, not the mockup's simpler low/mid scheme, for visual consistency). Filter by resume (server-side); sort by date (server-side) or score (client-side — `historyQuerySchema` doesn't support it). Detail is a click-through modal, not inline, since list rows don't carry the full `MatchResult`. |
| **Account** | DONE — Phase 9 | Profile, change password, sessions ("sign out everywhere"), and a danger zone for export + delete. |

### Navigation

DONE — Phase 9, `web/nav-shell.component.ts`. The desktop app has a toolbar
with no nav; the web build adds a primary nav (Resumes / Score / History) plus
an avatar menu for Account/sign-out. One deviation from the mockup: the
mockup's toolbar also carries a "⚙ Settings" button on every screen (it opens
the stopwords/term-boost/missing-keyword drawer); that stayed put on the Score
screen only rather than being promoted into the shared shell — the drawer's
state (resume, stopwords, term boosts, both penalty settings) is loaded and
owned entirely inside `AppComponent.loadAll()`, and hoisting it to the shell
would have meant relocating a decent chunk of that component's state
management for a settings surface that's conceptually about *scoring*, not
account-wide. The below-680px fixed bottom nav from the mockup is still not
built — out of scope for this phase along with the rest of true mobile
support (see the min-width guard, moved into this shell in Phase 9); nothing
below 860px reaches the nav at all right now, so that mockup CSS is
unreachable rather than forgotten.

### Token additions

The existing palette has no semantic state colors. The mockup adds four, in both
themes:

```css
--danger:#f85149;  --danger-subtle:rgba(248,81,73,.10);
--warn:#d29922;    --ok:#3fb950;              /* dark */
--danger:#cf222e;  --danger-subtle:rgba(207,34,46,.08);
--warn:#9a6700;    --ok:#1a7f37;              /* light */
```

These are additive and safe for the desktop build (it simply does not reference
them yet), though the existing `.divergence-penalty` styling could adopt
`--danger` later.

---

## Deployment

DONE (prep only) in Phase 10 — see **[docs/deployment-runbook.md](./deployment-runbook.md)**
for the actual step-by-step. Per an explicit scope decision that phase, this
prepares artifacts and documents steps; nothing has been provisioned live —
no real Postgres/SMTP account, no domain, no running deployment.

- **Dockerfile** in `packages/server`: build scoring → build frontend (`web`
  config, static) → build server → run Node serving API + static assets on
  `PORT`. Existed since Phase 7; **actually build-tested for the first time in
  Phase 10** (`docker build -f packages/server/Dockerfile .` from the repo
  root), which is what surfaced the next point. Went further than just the
  build: ran migrations and the container itself against the real local dev
  Postgres, confirmed `GET /api/health`, and specifically confirmed
  `POST /api/auth/register` succeeds — the one call that exercises `argon2`'s
  native binding, i.e. the exact thing the missing `.dockerignore` below
  would have silently broken. Full detail in
  [docs/deployment-runbook.md](./deployment-runbook.md)'s "Verified" section.
- **`.dockerignore` did not exist until Phase 10.** Without it, `COPY . .`
  copies the host's own `node_modules` over the image's freshly `npm ci`'d
  one (breaking `argon2`'s native binding — built for the host's OS/arch, not
  the Alpine container's) and bakes local `.env` files straight into an image
  layer. Added at the repo root.
- **Postgres**: managed instance (Neon/Supabase/RDS/Fly Postgres) — your
  choice, not provisioned here. Run `node packages/server/dist/db/migrate.js`
  once against it before serving traffic (runbook §3).
- **Env/secrets**: `DATABASE_URL`, `SESSION_SECRET`, SMTP creds, `PUBLIC_URL`
  (for email links), cookie domain — full reference table in the runbook.
  (Note: this repo's actual desktop config lives in the *root* `shared/
  config.ts`, port/databasePath only, and is deliberately untouched — the
  server has always had its own separate `packages/server/src/config.ts`,
  not an extension of the desktop one; see that file's own header comment.)
- **TLS + headers** at the proxy/server: HTTPS, plus the COOP/COEP/CORP
  headers above and a CSP comparable to the Electron one — already sent by
  the app itself (`packages/server/src/app.ts`); the proxy/host just needs to
  not strip them.
- **Email**: SMTP provider (Resend/Postmark/SES) — your choice. Verify domain
  (SPF/DKIM) so reset/verification mail lands.
- **Legal**: DONE in Phase 10 — Terms of Service + Privacy Policy pages at
  `/terms` and `/privacy` (`web/legal/`), linked from the register screen's
  footer (already wired since Phase 7 — the `href`s were there before the
  pages existed) and the avatar menu.
- **Rate limiting hardening**: DONE in Phase 10 — see the "Suggested build
  order" step 10 note below for what was actually wrong and fixed.
- **Cross-browser `crossOriginIsolated`**: DONE in Phase 10 — Chrome (Phase 7),
  Safari and Firefox (Phase 10) all confirm `window.crossOriginIsolated ===
  true` and a real `SharedArrayBuffer`. Getting there needed a different
  automation path per browser, not CDP for all three — see the build-order
  step 10 note below.

---

## Suggested build order (phased)

1. Scaffold `packages/server` (Fastify + Drizzle + Postgres), health route,
   Docker + local Postgres via compose.
2. Schema + migrations for all tables.
3. Auth: register → verify → login → session middleware → logout. Email wiring.
4. Forgot/reset + change-password + update-details + delete/export.
5. Domain endpoints (resumes, settings, history) mirroring the IPC channels.
6. Frontend: introduce the `shared/` `desktop/` `web/` folders; extract
   `StorageAdapter` interface into `shared/`; move current Electron impl into
   `desktop/` (unchanged); decouple `EmbeddingService` from `StorageService`
   (see "Three details"). Add the ESLint import-boundary rule.
   **Verify the Electron build still works unchanged** before/after this step.
7. Frontend: add `provideRouter` + `provideHttpClient` (both currently absent),
   the `web` build config, `HttpStorageAdapter` + `GET /api/bootstrap`, auth UI,
   guard and interceptor.
8. Frontend: responsive pass — **viewport unlock + min-width guard DONE**, see
   finding #1 above. Media queries, bottom-bar nav under 680px, and the drawer
   becoming a sheet on mobile are explicitly deferred past this phase (locked
   scope: desktop-viewport-first for now) — that work moves to whichever phase
   picks up full mobile support. Scoped to the web build so desktop layout is
   untouched.
9. Frontend: multi-resume + history UI, incl. the "Scoring against" picker —
   **DONE**, see "Three details" point 4 above.
10. COOP/COEP header verification across Safari/Chrome/Firefox; confirm client
    embedding still threads. Rate limiting, ToS/Privacy, deploy.
    **DONE in Phase 10:**
    - Chrome: verified live in Phase 7 (`window.crossOriginIsolated === true`,
      model + worker threading confirmed).
    - Safari and Firefox: no CDP-equivalent is reachable from either without
      something only a human at the machine can grant, so each needed a
      different path, found by trial rather than assumed upfront:
      - **Firefox** exposes WebDriver BiDi (`--remote-debugging-port`,
        despite the flag name) with **no OS permission required at all** — a
        ~40-line raw WebSocket client (`session.new` → `browsingContext.
        getTree` → `script.evaluate`) confirmed `crossOriginIsolated: true`,
        `SharedArrayBuffer` a real `function`, against Firefox 147.
      - **Safari** has no BiDi/CDP equivalent; AppleScript's `do JavaScript`
        works instead, but needs a *Safari-local* setting most users have
        never touched: Safari Settings → Advanced → "Show features for web
        developers" (reveals the Develop menu) → Develop → "Allow JavaScript
        from Apple Events". Not a macOS security prompt, so `--enable`/sudo
        never applied here — the earlier assumption that this needed a
        system permission grant was wrong. Once toggled: confirmed on Safari
        26.5.2 the same way, `crossOriginIsolated: true` and a real
        `SharedArrayBuffer`.
      - One dead end worth recording: pushing further to confirm the
        embedding worker's ORT-WASM/model assets actually load (not just
        that the isolation flags read true) hit Angular never bootstrapping
        under Safari's Apple-Events JS execution context specifically (empty
        `document.body`, no rendered form) — an automation-harness quirk,
        not a real Safari bug (the isolation flags themselves are a genuine
        browser capability check, independent of whether Angular has
        rendered anything). Chasing it further via `screencapture` for a
        visual check instead captured the *entire physical screen*, not just
        Safari — including unrelated open windows on the developer's own
        desktop — so that path was abandoned immediately and the screenshot
        deleted. `crossOriginIsolated`/`SharedArrayBuffer` being true was
        already the actual ask; this extra mile wasn't worth that privacy
        tradeoff.
    - Rate limiting: **DONE**, and it needed a real fix, not just review.
      `@fastify/rate-limit` was registered with `global: false` — meaning
      `GET /api/health` (public, hits Postgres every call) and the read side
      of resumes/settings/history/bootstrap had **no** ceiling at all; only
      routes that explicitly opted in via `writeLimit()` or the auth routes
      were covered. Fixed by flipping to `global: true` with a new
      `RATE_LIMIT_GLOBAL_MAX`/`RATE_LIMIT_GLOBAL_WINDOW` baseline (300/min
      default) that per-route limits still override where they exist.
      Verified with a new test reproducing the gap before the fix and
      confirming it closed after, same as every other fix in this project —
      `packages/server/test/auth.test.ts`, "throttles unauthenticated
      requests to routes with no route-specific limit". Full server suite:
      66/66.
    - ToS/Privacy: **DONE** — see "Deployment" above.
    - Deploy: **DONE (prep only)**, scope explicitly limited to artifacts +
      runbook, nothing provisioned live — see "Deployment" above and
      [docs/deployment-runbook.md](./deployment-runbook.md). Also surfaced a
      real, previously-untested bug: no `.dockerignore` existed, so `docker
      build` had literally never been run end-to-end against this Dockerfile
      before — added one and confirmed a real `docker build` succeeds.

---

## Verification

- **Server unit/integration**: spin up Postgres (compose), run auth flow tests
  (register → verify token → login → access protected route → logout), and CRUD
  tests for resumes/settings/history scoped per user. Confirm a second user
  cannot read the first user's data.
- **Email**: use a local catcher (Mailpit/Mailhog) in dev; assert verify/reset
  links are generated and single-use.
- **End-to-end in browser**: register → verify → upload a PDF (resources/ has
  test fixtures) → confirm only text hits the network (inspect request payload,
  no binary) → score a job → confirm result persists to history → reload →
  history present.
- **Embedding threading**: in the deployed app, check
  `crossOriginIsolated === true` in the console and that the model loads via the
  worker (network tab shows the ORT WASM + model fetch). If `false`, the
  COOP/COEP headers are misconfigured.
- **Scoring parity**: score the same resume/JD on desktop and web; the
  `MatchResult.score` should match (same `@resurank/scoring`, same client-side
  embedder).
- **Desktop regression check (critical)**: after the `StorageAdapter` refactor,
  run the Electron app (`npm run build && npm start`) and confirm resume upload,
  scoring, settings, stopwords, and Claude Desktop integration all still work —
  the desktop build must be byte-for-byte behavior-compatible.
- **Import-boundary check**: ESLint rule fails if `shared/` imports from
  `desktop/`/`web/`, or if `desktop/` and `web/` import each other.
- Keep `npm --prefix packages/scoring run test` green (scoring untouched).
