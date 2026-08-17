import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import Fastify, {type FastifyInstance, type FastifyServerOptions} from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {config} from './config.js';
import {registerAuthDecorators} from './plugins/auth.js';
import {adminRoutes} from './routes/admin.js';
import {authRoutes} from './routes/auth.js';
import {bootstrapRoutes} from './routes/bootstrap.js';
import {healthRoutes} from './routes/health.js';
import {historyRoutes} from './routes/history.js';
import {resumeRoutes} from './routes/resumes.js';
import {settingsRoutes} from './routes/settings.js';
import {userRoutes} from './routes/users.js';

const here = dirname(fileURLToPath(import.meta.url));

const cspDirectives = {
  'default-src': ["'self'"],
  'connect-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'script-src': ["'self'", "'wasm-unsafe-eval'", 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/**
 * Ceiling on the raw request body, replacing Fastify's implicit 1 MiB
 * default. This is sized for the largest *legitimate* body, `POST /api/history` with a
 * full settings snapshot attached (`settingsPayloadSchema`) plus a `result`
 * at its own cap (`MATCH_RESULT_MAX_BYTES`, routes/history.ts):
 *   stopwords 10k × ~110B  ≈ 1.10 MB
 *   termBoosts 5k × ~125B  ≈ 0.63 MB
 *   pinnedTerms 500 × ~140B ≈ 0.07 MB
 *   jobDescription/preference text (32k chars each) ≈ 0.06 MB
 *   result (capped)                                 ≈ 0.50 MB
 *                                            total   ≈ 2.36 MB
 * 3 MiB leaves headroom for JSON overhead without coming close to unbounded.
 * Every field summed above already has its own cap enforced by a zod schema
 * or a route-level check — this is a second, coarser backstop in front of
 * those, not a substitute for them.
 */
const MAX_REQUEST_BODY_BYTES = 3 * 1024 * 1024;

export interface BuildAppOptions {
  /**
   * Overrides the auth rate limit. Tests raise it so the flow suite is not
   * throttled, and lower it in one dedicated test to assert throttling works.
   */
  rateLimitMax?: number;
  /**
   * Overrides Fastify's trustProxy. Defaults to the production hop count
   * (1) when NODE_ENV=production, false otherwise. Tests use this to
   * exercise the proxy-trust boundary directly without NODE_ENV=production
   * (which also demands RESEND_API_KEY and other prod-only config).
   */
  trustProxy?: FastifyServerOptions['trustProxy'];
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {level: config.isProduction ? 'info' : 'debug'},
    // A hop count `1` trusts exactly the single reverse proxy / load balancer this app
    // is deployed behind and takes the client IP from the hop just before it.
    // Recount this if the real deployment topology ever adds another hop
    // (e.g. a CDN/WAF in front of the load balancer), since too high a count is as exploitable
    // as `true`, and too low collapses every real client behind the proxy onto the proxy's own IP.
    trustProxy: options.trustProxy ?? (config.isProduction ? 1 : false),
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    forceCloseConnections: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {directives: cspDirectives},
    // The client-side embedding worker needs `crossOriginIsolated` for
    // SharedArrayBuffer / threaded WASM.
    crossOriginOpenerPolicy: {policy: 'same-origin'},
    crossOriginEmbedderPolicy: {policy: 'require-corp'},
    crossOriginResourcePolicy: {policy: 'same-origin'},
  });

  await app.register(cookie, {secret: config.sessionSecret});

  // Global baseline for every route that doesn't set its own tighter limit
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? config.rateLimit.globalMax,
    timeWindow: config.rateLimit.globalWindow,
  });

  registerAuthDecorators(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, {rateLimitMax: options.rateLimitMax});
  await app.register(userRoutes, {rateLimitMax: options.rateLimitMax});
  await app.register(bootstrapRoutes);
  await app.register(resumeRoutes, {rateLimitMax: options.rateLimitMax});
  await app.register(settingsRoutes, {rateLimitMax: options.rateLimitMax});
  await app.register(historyRoutes, {rateLimitMax: options.rateLimitMax});
  await app.register(adminRoutes, {rateLimitMax: options.rateLimitMax});

  // Static hosting of the Angular web build. Absent in dev, where the Angular
  // dev server serves the frontend and proxies /api here.
  const staticRoot = resolve(here, config.staticDir);
  const hasStaticBuild = existsSync(staticRoot);

  if (hasStaticBuild) {
    await app.register(fastifyStatic, {root: staticRoot, wildcard: false});
  } else {
    app.log.warn({staticRoot}, 'no frontend build found — serving API only');
  }

  // SPA fallback: any non-/api GET that did not match a file returns index.html
  // so client-side routing works on deep links and refreshes.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/') || !hasStaticBuild) {
      return reply.code(404).send({error: 'not_found'});
    }
    return reply.sendFile('index.html');
  });

  return app;
}
