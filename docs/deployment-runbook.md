# ResuRank web — deployment runbook

Scope of this document, per an explicit decision in Phase 10: **prepare
artifacts and steps, provision nothing live.** Nothing here has been run
against a real hosting account. The Docker build and image itself *have*
been exercised for real (see "Verified" at the bottom); everything
downstream of that (which Postgres provider, DNS, TLS termination) is a
choice for whoever actually deploys this.

---

## 1. What you need before starting

- A Postgres instance reachable from wherever the container runs (Neon,
  Supabase, RDS, Fly Postgres, or your own). Any recent Postgres version —
  nothing here uses exotic extensions.
- A [Resend](https://resend.com) account and API key — the only transactional
  email path production supports (see `RESEND_API_KEY` below; the server
  fails fast at startup without it). Mailpit (used in local dev) is not for
  production. Verify SPF/DKIM for whatever sending domain you use, or
  verification/reset emails will land in spam or get rejected outright.
- A place to run one container that can reach both of the above and expose
  port 3001 (or whatever you set `PORT` to) behind TLS.
- A domain (or subdomain) for `PUBLIC_URL` — this is embedded in every
  verification/reset email link, so it must be the real public origin, not
  `localhost`.

## 2. Build the image

Build context is the **repo root**, not `apps/web/`:

```bash
docker build -f apps/web/Dockerfile -t resurank-server .
```

The build compiles `@resurank/scoring`, the server, and the Angular `web`
frontend configuration (which itself downloads the ~32MB embedding model into
the image via `apps/ui/scripts/fetch-model.mjs` — the model is served
same-origin from the container, not fetched from HuggingFace at runtime; see
`apps/web/src/app.ts`'s CSP comment for why that matters under COEP
`require-corp`).

`.dockerignore` (added in Phase 10) matters here: without it, `COPY . .`
would copy this machine's own `node_modules` over the image's freshly
`npm ci`'d one — breaking `argon2`'s native binding, built for the host's
OS/arch, not the Alpine container's — and would bake local `.env` files
(real DB/session/Resend values, even if just dev ones) straight into an image
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
  node apps/web/dist/db/migrate.js
```

This applies `apps/web/drizzle/*` via `drizzle-orm`'s migrator (not
`drizzle-kit`, which is a devDependency and isn't in the runtime image) and
exits — it's not the same process as the long-running server.

## 4. Environment variables

All read once at startup in `apps/web/src/config.ts`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string. |
| `SESSION_SECRET` | **yes** | — | Startup fails without it, but **nothing currently reads it** — see "Corrections" below before relying on it for anything. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `PUBLIC_URL` | no | `http://localhost:3001` | Real public origin — embedded in every email link. Must be `https://` in production. |
| `COOKIE_DOMAIN` | no | unset (host-only cookie) | Only set this if the API and frontend are on different subdomains of the same parent domain. Leave unset for the normal single-origin case. |
| `PORT` / `HOST` | no | `3001` / `0.0.0.0` | |
| `RESEND_API_KEY` | **yes** | — | Sends through [Resend](https://resend.com)'s HTTP API — the only mail path production supports; the server fails fast at startup without it. |
| `EMAIL_FROM` | no | `ResuRank <no-reply@resurank.local>` | Should be on a domain verified with Resend (SPF/DKIM set up there), or mail gets flagged/rejected. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | no | — | Fallback transport, only used if `RESEND_API_KEY` is unset — not relevant once `RESEND_API_KEY` is set for production. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW` | no | `5` / `15 minutes` | Credential + mail-sending endpoints. |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW` | no | `60` / `1 minute` | Authenticated writes (uploads, settings, history). |
| `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_GLOBAL_WINDOW` | no | `300` / `1 minute` | Baseline for every other route, including the public, unauthenticated `GET /api/health` — added in Phase 10, see "Corrections" below. |
| `STATIC_DIR` | no | `../../../apps/ui/dist/frontend/browser` | Only override if you restructure the image's layout. |

Generate `SESSION_SECRET` fresh for the real deployment — don't reuse the
value from any local `.env`. Note that this is hygiene against a *future*
change, not a control that is doing anything today: see "Corrections" below.

### Invalidating sessions

To sign every user out — after a suspected token leak, say — delete the rows.
Sessions live entirely in the `sessions` table, keyed by the SHA-256 digest of
the token in the cookie:

```sql
DELETE FROM sessions;
```

For a single account, prefer the application paths, which do this already:
`POST /api/auth/logout-all`, `POST /api/admin/users/:id/revoke-sessions`, or
suspending the account (`PATCH /api/admin/users/:id/status`). A password change
or reset also revokes every session for that user automatically.

Restarting the server does **not** invalidate sessions, and neither does
changing `SESSION_SECRET` — see below.

## 5. TLS and headers

Terminate TLS at whatever sits in front of the container (a platform-managed
load balancer, or your own reverse proxy). The app itself sends, on every
response, via `@fastify/helmet` (`apps/web/src/app.ts`):

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

### `trustProxy` and the hop count

In production `app.ts` sets `trustProxy: 1` — Fastify trusts exactly one
reverse proxy hop and derives `request.ip` (and therefore every rate limit
bucket, plus `sessions.ip` / `admin_audit_log.ip`) from the `X-Forwarded-For`
entry just before that hop. This assumes the topology in §1/§5 above: **one**
load balancer or reverse proxy between the internet and this container.

If you put anything else in front of that load balancer — a CDN, a WAF, a
second internal proxy — the hop count is now wrong and must be updated in
`apps/web/src/app.ts` (`trustProxy: ...`) to match, or the same class of bug
this replaced comes back:

- **Hop count too low** (e.g. left at `1` with two real hops in front):
  `request.ip` resolves to the *first* proxy's address, not the real client,
  for every request — every legitimate user behind it collapses onto the
  same rate-limit bucket and the same IP in `sessions.ip`.
- **Hop count too high, or back to `true`/unbounded**: a client can set its
  own `request.ip` by sending extra `X-Forwarded-For` entries, which
  defeats every rate limit (including the login brute-force throttle) and
  lets an attacker write arbitrary IPs into `sessions.ip` and
  `admin_audit_log.ip`.

Recount the hops for your actual deployment before going live, and update
this note when the topology changes. See the comment above `trustProxy` in
`app.ts` and the [Fastify `trustProxy` docs](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

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
- [ ] With the Network tab open, run a match and confirm the ORT WASM binary
      and the model files (`/assets/models/...`) actually load, initiated
      from the embedding worker rather than the main thread. This is
      stricter than "a score eventually comes back" (already covered above)
      — a broken threaded path can still silently succeed by falling back to
      slower single-threaded scoring, with no visible error.
- [ ] Hit `/api/health` rapidly (>300 requests within a minute) from one
      client and confirm a `429` eventually appears — confirms the global
      rate-limit baseline reached production intact.
- [ ] Visit `/terms` and `/privacy` and confirm they render.

## 7. Rollback

Since migrations only ever add (no destructive schema changes exist yet in
`apps/web/drizzle/`), rolling back the container image to a previous
tag is safe without a corresponding down-migration. If a future migration
becomes destructive, add an explicit rollback note here at that time.

---

## Corrections / open items (kept current — Phase 10)

- **`SESSION_SECRET` does nothing, and this table used to claim otherwise.**
  Until now both this runbook and `apps/web/README.md` said it "signs the
  session cookie" and that "rotating it invalidates every existing session."
  Neither is true, and the second one is the dangerous half — it reads as an
  incident-response lever and would silently fail as one.

  What actually happens: `config.sessionSecret` is `required()`, so the server
  refuses to start without it, and it is handed to `@fastify/cookie` as the
  signing secret. But that only *enables* the opt-in `{signed: true}` /
  `unsignCookie` APIs, and neither is ever called — `setSessionCookie` sets a
  plain cookie and `requireAuth` reads it raw. Checked across every commit on
  every branch: `signed: true` has never appeared in this repository. It was
  not wired up and later removed; it was never wired up.

  So rotating `SESSION_SECRET` and restarting invalidates **zero** sessions.
  Every outstanding cookie keeps working. Use the `DELETE FROM sessions` path
  in §4 instead.

  Nothing is currently *weakened* by this: the cookie holds 32 bytes of
  `randomBytes` output, the server stores only its SHA-256 digest and looks the
  session up by that digest, so forging one means guessing a 256-bit random
  value. An HMAC over it would add no security — there is no structure to
  tamper with. The variable is a vestige of the conventional Express/Fastify
  session pattern, where the cookie carries the session id and signing *is*
  load-bearing; this codebase chose the stronger opaque-token design and the
  scaffolding came along with it.

  Open decision — either drop the variable entirely (recommended, since signing
  buys nothing here) or actually sign the cookie. Until that lands, keep setting
  it: the server will not boot otherwise.

- **Rate limiting**: `GET /api/health` and the read side of
  resumes/settings/history/bootstrap had *no* rate limit at all before Phase
  10 (`@fastify/rate-limit` was registered with `global: false`, so only
  routes that explicitly opted in via `writeLimit()`/the auth routes were
  covered). Fixed by registering the plugin `global: true` with a new
  `RATE_LIMIT_GLOBAL_MAX`/`RATE_LIMIT_GLOBAL_WINDOW` baseline (300/minute by
  default); per-route limits still override it where they exist. Verified
  with a new test (`apps/web/test/auth.test.ts`, "throttles
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

- `docker build -f apps/web/Dockerfile -t resurank-server .` — clean
  build from the repo root, all three build stages (scoring, server,
  frontend `web` config) complete.
- `node apps/web/dist/db/migrate.js` run inside the built image
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
  - The SPA fallback correctly serves `apps/ui/dist/frontend/browser/index.html`
    for a client route (`GET /login` → `200`).
- Test data (the one registered user) and the test image/container were
  cleaned up afterward — nothing was left running or in the dev database.
