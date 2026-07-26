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
Generate a real `SESSION_SECRET` even for local dev:

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
| `SESSION_SECRET` | **yes** | — | Signs the session cookie. Rotating it invalidates every existing session. |
| `NODE_ENV` | no | `development` | `production` enables `trustProxy` and raises the log level. |
| `PORT` | no | `3001` | |
| `HOST` | no | `0.0.0.0` | |
| `PUBLIC_URL` | no | `http://localhost:3001` | Embedded in every verification/reset email link — must be the real public origin (and `https://`) in production. |
| `COOKIE_DOMAIN` | no | unset (host-only cookie) | Only set if the API and frontend are on different subdomains of the same parent domain. |
| `STATIC_DIR` | no | `../../../frontend/dist/frontend/browser` | Where the built Angular `web` bundle is served from. Absent in dev (the Angular dev server handles the frontend instead) — the server logs a warning and serves API-only. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW` | no | `5` / `15 minutes` | Credential + mail-sending endpoints (login, register, password reset, etc.). |
| `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_WRITE_WINDOW` | no | `60` / `1 minute` | Authenticated writes — resume uploads, saved scores, settings changes. |
| `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_GLOBAL_WINDOW` | no | `300` / `1 minute` | Baseline for every other route, including the public `GET /api/health`. Per-route limits above override this where they apply. |
| `SMTP_HOST` / `SMTP_PORT` | no | `localhost` / `1025` | Points at Mailpit by default (dev). Use a real provider (Resend/Postmark/SES/etc.) in production, on a domain with SPF/DKIM set up. |
| `SMTP_USER` / `SMTP_PASS` | no | unset | Only needed for providers that require SMTP auth. |
| `SMTP_FROM` | no | `ResuRank <no-reply@resurank.local>` | |

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
docker build -f packages/server/Dockerfile -t resurank-server .
```

The image builds `@resurank/scoring`, this server, and the Angular `web`
configuration (which downloads the embedding model into the image so it's
served same-origin — see `frontend/scripts/fetch-model.mjs`). Full deploy
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
