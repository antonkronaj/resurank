# @resurank/server

The multi-user web API behind ResuRank's web build: auth, Postgres-backed
CRUD for resumes/settings/scoring history, transactional email, and static
hosting of the Angular `web` frontend build.

**Performs no ML.** Resume PDFs are parsed client-side and the embedding
model + scoring both run in the browser (see `@resurank/scoring`); this
server only ever sees extracted resume *text*, never a PDF, and never runs
inference itself.

For everything else in the ResuRank monorepo — the Electron desktop app,
`@resurank/scoring`, the MCP server — see the [repo root README](../../README.md).
For deploying this server to a real environment, see
[docs/deployment-runbook.md](../../docs/deployment-runbook.md).

## Stack

Fastify 5, Drizzle ORM + Postgres, argon2id password hashing, Zod validation,
Nodemailer for transactional email, `@fastify/{helmet,cookie,rate-limit,static}`.

## Local development

### 1. Start Postgres + Mailpit

```bash
npm run db:up
```

Starts the services in `docker-compose.yml`: Postgres on `localhost:5433`
(not 5432 — see the compose file for why), and [Mailpit](https://mailpit.axllent.org/)
(catches all outbound mail in dev — no real SMTP provider needed; web UI at
`http://localhost:8025`).

### 2. Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` already point at the services from step 1.
`SESSION_SECRET` has to be set or the server won't boot, though nothing reads
it today (see the note under Environment variables). Any value works for local
dev; generate a real one anyway so the habit survives the fix:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Apply the database schema

```bash
npm run db:migrate
```

### 4. Run the server

```bash
npm run dev
```

Watches and rebuilds `src/` on change, restarting the server. In dev, the
Angular CLI dev server (`frontend`) serves the frontend and proxies `/api`
here — this server serving the frontend itself (step below) is a
production-build concern, not part of the usual dev loop.

### 5. Run the tests

```bash
npm test
```

Integration tests against the real Postgres + Mailpit from step 1 — they
skip mail-dependent cases if Mailpit isn't reachable, and clean up their own
rows. Run serially (`--test-concurrency=1`, already set) since several
suites share one database and mailbox.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | TypeScript watch build + `node --watch` — the usual local dev loop. |
| `npm run build` | One-shot compile to `dist/`. |
| `npm start` | Run the compiled server (`node dist/index.js`). Needs `npm run build` first. |
| `npm test` | Compiles tests to `build-test/` and runs them against real Postgres/Mailpit. |
| `npm run clean` | Removes `dist/`. |
| `npm run db:up` / `db:down` | Start/stop local Postgres + Mailpit (`docker-compose.yml`). |
| `npm run db:generate` | Generate a new Drizzle migration from schema changes (`src/db/schema.ts`). |
| `npm run db:migrate` | Apply pending migrations via `drizzle-kit` (dev only — see "Building & running" for the production path, which doesn't depend on `drizzle-kit`). |
| `npm run db:studio` | Open Drizzle Studio against the configured `DATABASE_URL`. |

## Environment variables

Read once at startup in `src/config.ts`. `.env` is loaded automatically in
development (Node's built-in `process.loadEnvFile`); real deployments should
inject these directly rather than shipping a `.env` file — see
[docs/deployment-runbook.md](../../docs/deployment-runbook.md) for why (a
`.env` copied into a Docker image bakes secrets into an image layer).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string. |
| `SESSION_SECRET` | **yes** | — | Required at startup, but **nothing reads it** — see below. |
| `NODE_ENV` | no | `development` | `production` enables `trustProxy` and raises the log level. |
| `PORT` | no | `3001` | |
| `HOST` | no | `0.0.0.0` | |
| `PUBLIC_URL` | no | `http://localhost:3001` | Embedded in every verification/reset email link — must be the real public origin (and `https://`) in production. |
| `COOKIE_DOMAIN` | no | unset (host-only cookie) | Only set if the API and frontend are on different subdomains of the same parent domain. |
| `STATIC_DIR` | no | `../../../apps/ui/dist/frontend/browser` | Where the built Angular `web` bundle is served from. Absent in dev (the Angular dev server handles the frontend instead) — the server logs a warning and serves API-only. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW` | no | `5` / `15 minutes` | Credential + mail-sending endpoints (login, register, password reset, etc.). |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW` | no | `60` / `1 minute` | Authenticated writes — resume uploads, saved scores, settings changes. |
| `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_GLOBAL_WINDOW` | no | `300` / `1 minute` | Baseline for every other route, including the public `GET /api/health`. Per-route limits above override this where they apply. |
| `EMAIL_FROM` | no | `ResuRank <no-reply@resurank.local>` | From address, used no matter which mail path below sends the message. |
| `RESEND_API_KEY` | **yes in production** | unset | Sends through [Resend](https://resend.com)'s HTTP API — the only mail path production supports; the server fails fast at startup without it. Optional in dev (falls back to SMTP/Mailpit below when unset), so dev can send through Resend too by setting this. `EMAIL_FROM`'s domain must be verified with Resend (SPF/DKIM). |
| `SMTP_HOST` / `SMTP_PORT` | no | `localhost` / `1025` | Fallback transport used only when `RESEND_API_KEY` is unset. Points at Mailpit by default (dev/test); not intended for production. |
| `SMTP_USER` / `SMTP_PASS` | no | unset | Only needed for an SMTP provider that requires auth. |

### A note on `SESSION_SECRET`

It is passed to `@fastify/cookie` as the signing secret, but that only enables
the opt-in `{signed: true}` / `unsignCookie` APIs — and neither is ever called.
`setSessionCookie` sets a plain cookie and `requireAuth` reads it raw, so the
secret never participates in anything. Earlier revisions of this table claimed
it signed the session cookie and that rotating it invalidated every session;
both were wrong. **Rotating it invalidates nothing.**

To actually sign everyone out, delete the rows — sessions live entirely in the
`sessions` table, keyed by the SHA-256 digest of the cookie's token:

```sql
DELETE FROM sessions;
```

Per-account, use `POST /api/auth/logout-all` or
`POST /api/admin/users/:id/revoke-sessions`; a password change or reset already
revokes that user's sessions automatically.

None of this weakens the session mechanism: the cookie carries 32 bytes of
`randomBytes` output and the server looks sessions up by SHA-256 digest, so
forging one means guessing a 256-bit value and an HMAC would add nothing. The
variable is a leftover of the conventional Express/Fastify pattern where the
cookie carries the session id and signing *is* load-bearing. Keep setting it
until it is either removed or genuinely wired up — the server won't boot
without it.

## Building & running for production

```bash
npm run build
npm start
```

Requires the frontend's `web` build to exist at `STATIC_DIR` (built via
`npm run build:frontend:web` from the repo root) and a real database
reachable at `DATABASE_URL`, migrated (see below).

### Docker

Build context is the **repo root**, not this directory — it needs
`@resurank/scoring` and the `frontend` `web` build alongside this package:

```bash
docker build -f apps/web/Dockerfile -t resurank-server .
```

The image builds `@resurank/scoring`, this server, and the Angular `web`
configuration (which downloads the embedding model into the image so it's
served same-origin — see `apps/ui/scripts/fetch-model.mjs`). Full deploy
steps, including running migrations against the built image, are in
[docs/deployment-runbook.md](../../docs/deployment-runbook.md).

### Migrations in production

The build produces `dist/db/migrate.js` — a one-shot runner using Drizzle's
own migrator, deliberately not `drizzle-kit` (a devDependency not present in
the production image):

```bash
node dist/db/migrate.js
```

Run this once against the real database before the app serves traffic (or as
a pre-deploy/release-phase hook, if your platform supports one).
