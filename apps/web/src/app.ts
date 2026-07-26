import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import Fastify, {type FastifyInstance} from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {config} from './config.js';
import {registerAuthDecorators} from './plugins/auth.js';
import {authRoutes} from './routes/auth.js';
import {bootstrapRoutes} from './routes/bootstrap.js';
import {healthRoutes} from './routes/health.js';
import {historyRoutes} from './routes/history.js';
import {resumeRoutes} from './routes/resumes.js';
import {settingsRoutes} from './routes/settings.js';
import {userRoutes} from './routes/users.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Content-Security-Policy for the web build. Mirrors the Electron production
 * CSP (apps/desktop/src/main/index.ts) minus the `app:` custom scheme, which is desktop-only.
 * `wasm-unsafe-eval` and `worker-src blob:` are required by the client-side
 * ONNX embedding worker.
 *
 * `connect-src 'self'` is enough for the model fetch: it's served same-origin
 * from /assets/models (apps/ui/scripts/fetch-model.mjs), not huggingface.co.
 * That isn't just tidier — under COEP `require-corp` below, a cross-origin
 * fetch from huggingface.co has no CORP header and gets blocked outright, so
 * this and require-corp are a matched pair. See docs/web-deployment-plan.md's
 * "CORRECTIONS TO THE PLAN" note for why an earlier version of this file
 * allowed huggingface.co here.
 */
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

export interface BuildAppOptions {
  /**
   * Overrides the auth rate limit. Tests raise it so the flow suite is not
   * throttled, and lower it in one dedicated test to assert throttling works.
   */
  rateLimitMax?: number;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {level: config.isProduction ? 'info' : 'debug'},
    trustProxy: config.isProduction,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {directives: cspDirectives},
    // The client-side embedding worker needs `crossOriginIsolated` for
    // SharedArrayBuffer / threaded WASM. Electron uses COEP `credentialless`,
    // which Safari does not support; `require-corp` works everywhere but
    // requires every cross-origin subresource to carry a CORP header.
    crossOriginOpenerPolicy: {policy: 'same-origin'},
    crossOriginEmbedderPolicy: {policy: 'require-corp'},
    crossOriginResourcePolicy: {policy: 'same-origin'},
  });

  await app.register(cookie, {secret: config.sessionSecret});

  // Global baseline for every route that doesn't set its own tighter limit
  // via `writeLimit()`/`authRoutes`/`userRoutes` below (GET /api/health and
  // the read side of resumes/settings/history/bootstrap otherwise had no
  // ceiling at all — this was the gap Phase 10 closed). `rateLimitMax`
  // reuses the same test-only override those routes already take, so the
  // handful of tests that intentionally lower a specific route's limit (or
  // raise it to avoid throttling an entire flow suite) affect this baseline
  // the same way instead of needing a second knob.
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
