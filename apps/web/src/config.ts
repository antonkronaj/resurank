import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Server configuration, resolved from the environment at startup.
 *
 * This is deliberately separate from the repo-root `shared/config.ts`, which
 * configures the Electron desktop app (local JSON data dir). The desktop build
 * must never need Postgres or SMTP settings, so web-only concerns live here.
 */

// Node 22 built-in .env loading — optional, real deployments inject env vars.
// Candidates cover running from `dist/` and from `build-test/src/`, plus the
// npm-script cwd (the package root). First hit wins; none is fine.
for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(dirname(fileURLToPath(import.meta.url)), '../.env'),
  resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'),
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

  smtp: {
    host: optional('SMTP_HOST', 'localhost'),
    port: Number(optional('SMTP_PORT', '1025')),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: optional('SMTP_FROM', 'ResuRank <no-reply@resurank.local>'),
  },
} as const;

export type Config = typeof config;
