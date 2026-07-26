# ResuRank web — deployment runbook

Scope of this document, per an explicit decision in Phase 10: **prepare
artifacts and steps, provision nothing live.** Nothing here has been run
against a real hosting account. The Docker build and image itself *have*
been exercised for real (see "Verified" at the bottom); everything
downstream of that (which Postgres/SMTP provider, DNS, TLS termination) is a
choice for whoever actually deploys this.

---

## 1. What you need before starting

- A Postgres instance reachable from wherever the container runs (Neon,
  Supabase, RDS, Fly Postgres, or your own). Any recent Postgres version —
  nothing here uses exotic extensions.
- An SMTP provider for transactional email (Resend, Postmark, SES, etc.).
  Mailpit (used in local dev) is not for production. Verify SPF/DKIM for
  whatever sending domain you use, or verification/reset emails will land in
  spam or get rejected outright.
- A place to run one container that can reach both of the above and expose
  port 3001 (or whatever you set `PORT` to) behind TLS.
- A domain (or subdomain) for `PUBLIC_URL` — this is embedded in every
  verification/reset email link, so it must be the real public origin, not
  `localhost`.

## 2. Build the image

Build context is the **repo root**, not `packages/server/`:

```bash
docker build -f packages/server/Dockerfile -t resurank-server .
```

The build compiles `@resurank/scoring`, the server, and the Angular `web`
frontend configuration (which itself downloads the ~32MB embedding model into
the image via `frontend/scripts/fetch-model.mjs` — the model is served
same-origin from the container, not fetched from HuggingFace at runtime; see
`packages/server/src/app.ts`'s CSP comment for why that matters under COEP
`require-corp`).

`.dockerignore` (added in Phase 10) matters here: without it, `COPY . .`
would copy this machine's own `node_modules` over the image's freshly
`npm ci`'d one — breaking `argon2`'s native binding, built for the host's
OS/arch, not the Alpine container's — and would bake local `.env` files
(real DB/session/SMTP values, even if just dev ones) straight into an image
layer. Don't remove it.

Push to whatever registry your host pulls from:

```bash
docker tag resurank-server your-registry/resurank-server:latest
docker push your-registry/resurank-server:latest
```

## 3. Run migrations

Once, against the real database, before the app serves traffic (or as a
release-phase/pre-deploy hook if your platform supports one):

```bash
docker run --rm -e DATABASE_URL=... your-registry/resurank-server:latest \
  node packages/server/dist/db/migrate.js
```

This applies `packages/server/drizzle/*` via `drizzle-orm`'s migrator (not
`drizzle-kit`, which is a devDependency and isn't in the runtime image) and
exits — it's not the same process as the long-running server.

## 4. Environment variables

All read once at startup in `packages/server/src/config.ts`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string. |
| `SESSION_SECRET` | **yes** | — | Signs the session cookie. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotating it invalidates every existing session. |
| `PUBLIC_URL` | no | `http://localhost:3001` | Real public origin — embedded in every email link. Must be `https://` in production. |
| `COOKIE_DOMAIN` | no | unset (host-only cookie) | Only set this if the API and frontend are on different subdomains of the same parent domain. Leave unset for the normal single-origin case. |
| `PORT` / `HOST` | no | `3001` / `0.0.0.0` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | no (defaults point at local Mailpit) | — | Point these at your real provider. `SMTP_FROM` should be on a domain with SPF/DKIM set up, or mail gets flagged/rejected. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW` | no | `5` / `15 minutes` | Credential + mail-sending endpoints. |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW` | no | `60` / `1 minute` | Authenticated writes (uploads, settings, history). |
| `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_GLOBAL_WINDOW` | no | `300` / `1 minute` | Baseline for every other route, including the public, unauthenticated `GET /api/health` — added in Phase 10, see "Corrections" below. |
| `STATIC_DIR` | no | `../../../frontend/dist/frontend/browser` | Only override if you restructure the image's layout. |

Generate `SESSION_SECRET` fresh for the real deployment — don't reuse the
value from any local `.env`.

## 5. TLS and headers

Terminate TLS at whatever sits in front of the container (a platform-managed
load balancer, or your own reverse proxy). The app itself sends, on every
response, via `@fastify/helmet` (`packages/server/src/app.ts`):

- A CSP matching the Electron build's, minus the `app:` scheme.
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

The COOP/COEP pair is what makes `crossOriginIsolated` true in the browser,
which the client-side embedding worker needs for threaded WASM. If your
reverse proxy strips or rewrites headers, explicitly confirm these three
survive to the browser — a proxy that drops them silently degrades the app
(scoring still works single-threaded in most browsers, but slower, with no
visible error) rather than breaking it loudly.

If `trustProxy` needs adjusting for your specific proxy setup (it's enabled
whenever `NODE_ENV=production`), see the `Fastify({trustProxy: ...})` call in
`app.ts`.

## 6. Post-deploy verification checklist

Run through this once against the real deployment before calling it live:

- [ ] `curl https://<your-domain>/api/health` returns `{"status":"ok","database":"ok"}`.
- [ ] Register a real account, receive the verification email, confirm the
      link points at `https://<your-domain>/...` (checks `PUBLIC_URL`).
- [ ] Sign in, upload a resume, run a match, confirm it appears in History.
- [ ] In the browser console: `window.crossOriginIsolated === true`. If not,
      the COOP/COEP headers aren't reaching the browser intact — see §5.
- [ ] Confirm `crossOriginIsolated` in **Safari and Firefox**, not just
      Chrome — Safari in particular has had COEP/SharedArrayBuffer quirks
      historically, which is why this server uses COEP `require-corp` rather
      than `credentialless` (see the comment in `app.ts`). Confirmed against
      localhost dev in Phase 10 (both browsers: `crossOriginIsolated: true`,
      real `SharedArrayBuffer`) — re-run against the real domain once
      deployed, since a proxy in front of the real deployment could still
      drop the headers even though the app itself is fine. See "Corrections"
      below for exactly how to check each browser without a full CDP-style
      automation setup.
- [ ] Hit `/api/health` rapidly (>300 requests within a minute) from one
      client and confirm a `429` eventually appears — confirms the global
      rate-limit baseline reached production intact.
- [ ] Visit `/terms` and `/privacy` and confirm they render.

## 7. Rollback

Since migrations only ever add (no destructive schema changes exist yet in
`packages/server/drizzle/`), rolling back the container image to a previous
tag is safe without a corresponding down-migration. If a future migration
becomes destructive, add an explicit rollback note here at that time.

---

## Corrections / open items (kept current — Phase 10)

- **Rate limiting**: `GET /api/health` and the read side of
  resumes/settings/history/bootstrap had *no* rate limit at all before Phase
  10 (`@fastify/rate-limit` was registered with `global: false`, so only
  routes that explicitly opted in via `writeLimit()`/the auth routes were
  covered). Fixed by registering the plugin `global: true` with a new
  `RATE_LIMIT_GLOBAL_MAX`/`RATE_LIMIT_GLOBAL_WINDOW` baseline (300/minute by
  default); per-route limits still override it where they exist. Verified
  with a new test (`packages/server/test/auth.test.ts`, "throttles
  unauthenticated requests to routes with no route-specific limit") using the
  same reproduce-before/after-fix approach as every other Phase 1–9 fix.
- **`.dockerignore` did not exist before Phase 10.** `docker build` had never
  been run end-to-end against this Dockerfile prior to this phase — adding it
  and actually running the build surfaced this rather than a review alone.
- **Safari/Firefox `crossOriginIsolated`: DONE in Phase 10.** Chrome was
  verified live in Phase 7; Safari and Firefox followed in Phase 10, each via
  a different path (there's no single CDP-equivalent that covers all three):
  - **Firefox**: `firefox --remote-debugging-port=<port>` starts a
    **WebDriver BiDi** server (despite the CDP-sounding flag name) — no OS
    permission needed. Connect a raw WebSocket client, send `session.new`,
    then `browsingContext.getTree` to get a context id, then
    `script.evaluate` with that context to run arbitrary JS. Confirmed
    `crossOriginIsolated: true` and a real `SharedArrayBuffer` this way.
  - **Safari**: no BiDi/CDP equivalent at all. AppleScript's `do JavaScript
    "..." in front document` works, but only after a *Safari-local* setting
    most people have never touched — Safari Settings → Advanced → "Show
    features for web developers" → the resulting Develop menu → "Allow
    JavaScript from Apple Events". This is **not** a macOS security prompt
    (no `safaridriver --enable`, no sudo, no Automation/Accessibility grant
    needed) — that was the wrong assumption initially. Once toggled,
    confirmed the same two values.
  - Re-run either check whenever this matters again: point the browser at a
    running instance, then (Firefox) the BiDi script above, or (Safari) the
    one-line AppleScript. If it fails on Safari with an error naming "Allow
    JavaScript from Apple Events", that's the toggle above, not a broken
    deployment.
- **This is not a substitute for an actual security/infra review** before a
  real public launch — treat it as a starting checklist, not a sign-off.

## Verified (Phase 10)

Not just a build — the image was actually run against the real (local) dev
Postgres, on the same Docker network:

- `docker build -f packages/server/Dockerfile -t resurank-server .` — clean
  build from the repo root, all three build stages (scoring, server,
  frontend `web` config) complete.
- `node packages/server/dist/db/migrate.js` run inside the built image
  against the real dev Postgres container — applied cleanly (all 6 tables
  already present and correct from local dev; running it again is the same
  no-op a real first deploy's "apply migrations" step would be once already
  up to date).
- Container started for real (`docker run`), and:
  - `GET /api/health` → `{"status":"ok","database":"ok"}`.
  - `POST /api/auth/register` → `200`, no crash — this specifically exercises
    `argon2`'s native binding inside Alpine, the exact thing the missing
    `.dockerignore` would have broken by shipping the host's own
    `node_modules` into the image instead of the container's own `npm ci`
    output.
  - Response headers on a real request carry the full CSP + COOP/COEP/CORP
    set from `app.ts`, unchanged from the local dev server.
  - The SPA fallback correctly serves `frontend/dist/frontend/browser/index.html`
    for a client route (`GET /login` → `200`).
- Test data (the one registered user) and the test image/container were
  cleaned up afterward — nothing was left running or in the dev database.
