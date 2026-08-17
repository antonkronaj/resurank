import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Server configuration, resolved from the environment at startup.
 *
 * This is deliberately separate from `apps/desktop/src/config.ts`, which
 * configures the Electron desktop app (local JSON data dir). The desktop build
 * must never need Postgres or SMTP settings, so web-only concerns live here.
 */

// Node 22 built-in .env loading — optional, real deployments inject env vars.
// Candidates cover running from `dist/` and from `build-test/src/`, plus the
// npm-script cwd (the package root). First hit wins; none is fine.
//
// `NODE_ENV=test` (set by the `test` script in package.json, before this
// module ever runs) loads `.env.test` instead of `.env` — a separate file so
// the test suite always points at the docker-compose Postgres on port 5433
// (see docker-compose.yml) rather than whatever `.env` has configured for
// local dev, which may be a different, non-disposable database on 5432.
const envFileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

for (const candidate of [
  resolve(process.cwd(), envFileName),
  resolve(dirname(fileURLToPath(import.meta.url)), '../' + envFileName),
  resolve(dirname(fileURLToPath(import.meta.url)), '../../' + envFileName),
]) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch {
    // Not present here — try the next candidate.
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProduction,
  port: Number(optional('PORT', '3001')),
  host: optional('HOST', '0.0.0.0'),

  /** Postgres connection string. */
  databaseUrl: required('DATABASE_URL'),

  /** Secret used to sign the session cookie. */
  sessionSecret: required('SESSION_SECRET'),

  /** Public origin, used to build links in verification / reset emails. */
  publicUrl: optional('PUBLIC_URL', 'http://localhost:3001'),

  /** Cookie domain; leave unset for host-only cookies (the usual case). */
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,

  /**
   * Directory containing the built Angular web bundle, served statically.
   * Resolved relative to the compiled `dist/` dir, so three levels up from
   * apps/web/dist reaches the repo root.
   */
  staticDir: optional('STATIC_DIR', '../../../apps/ui/dist/frontend/browser'),

  /**
   * How often lib/cleanup.ts sweeps expired sessions and email tokens.
   * Runs once immediately at startup, then on this interval — see
   * index.ts. A single-container deploy runs this in-process rather than
   * via an external cron.
   */
  cleanupIntervalMs: Number(optional('CLEANUP_INTERVAL_MS', String(60 * 60 * 1000))),  // 1 hour

  rateLimit: {
    /** Throttle for credential and mail-sending endpoints. */
    authMax: Number(optional('RATE_LIMIT_AUTH_MAX', '5')),
    authWindow: optional('RATE_LIMIT_AUTH_WINDOW', '15 minutes'),
    /** Looser throttle for authenticated writes — ordinary app usage. */
    writeMax: Number(optional('RATE_LIMIT_WRITE_MAX', '60')),
    writeWindow: optional('RATE_LIMIT_WRITE_WINDOW', '1 minute'),
    /**
     * Baseline for every route with no more specific limit above — GET
     * /api/health (public, hits Postgres on every call) and the read side of
     * resumes/settings/history/bootstrap otherwise had no ceiling at all.
     */
    globalMax: Number(optional('RATE_LIMIT_GLOBAL_MAX', '300')),
    globalWindow: optional('RATE_LIMIT_GLOBAL_WINDOW', '1 minute'),
  },

  /** Shared by both mail paths below — see lib/email.ts. */
  email: {
    from: optional('EMAIL_FROM', 'ResuRank <no-reply@resurank.local>'),
  },

  /**
   * Resend API key. When set, lib/email.ts sends through Resend's HTTP API
   * (via the `resend` SDK) instead of the SMTP transport below — this is how
   * dev can opt into Resend without a separate build. Required in production
   * (see the fail-fast check below); optional everywhere else, where an
   * unset key falls back to SMTP/Mailpit.
   */
  resend: {
    apiKey: process.env.RESEND_API_KEY || undefined,
  },

  /**
   * Fallback transport, and the only one the test suite uses (`.env.test`
   * never sets RESEND_API_KEY) — SMTP to Mailpit in dev/test via
   * docker-compose.yml. Real deployments should set RESEND_API_KEY instead
   * of pointing this at a real SMTP provider.
   */
  smtp: {
    host: optional('SMTP_HOST', 'localhost'),
    port: Number(optional('SMTP_PORT', '1025')),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
  },

  /**
   * Bootstrap admin, seeded by lib/admin-seed.ts on every startup. Both unset
   * is a normal deployment with no admin yet (or one already granted through
   * the app); one set without the other is almost certainly a typo, so that
   * fails fast rather than silently skipping the seed. This account's
   * password is env-owned: the seeder re-hashes it on every boot, so
   * rotating a leaked credential is "change the env var and restart," not a
   * password reset. See ADMIN_EMAIL/ADMIN_PASSWORD in .env.example.
   */
  admin: {
    email: process.env.ADMIN_EMAIL || undefined,
    password: process.env.ADMIN_PASSWORD || undefined,
  },
} as const;

export type Config = typeof config;

if (Boolean(config.admin.email) !== Boolean(config.admin.password)) {
  throw new Error(
    'ADMIN_EMAIL and ADMIN_PASSWORD must both be set, or both left unset.',
  );
}

const ADMIN_PASSWORD_MIN_LENGTH = 10; // matches lib/validation.ts passwordSchema

if (config.admin.password && config.admin.password.length < ADMIN_PASSWORD_MIN_LENGTH) {
  throw new Error(
    `ADMIN_PASSWORD must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`,
  );
}

// A production deployment silently falling back to the Mailpit-shaped SMTP
// defaults would mean verification/reset emails go nowhere — fail at
// startup instead of on the first registration.
if (config.isProduction && !config.resend.apiKey) {
  throw new Error('RESEND_API_KEY is required in production.');
}
