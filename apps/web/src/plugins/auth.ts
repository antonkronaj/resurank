import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {User} from '../db/schema.js';
import {sendError} from '../lib/errors.js';
import {SESSION_COOKIE, clearSessionCookie, resolveSession} from '../lib/sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `requireAuth`; null on unauthenticated routes. */
    user: User | null;
    sessionId: string | null;
  }
}

/**
 * Declared at the root instance so every request object has the same shape.
 * Called from buildApp before routes are registered.
 */
export function registerAuthDecorators(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
}

/**
 * preHandler for protected routes: resolves the session cookie to a user or
 * rejects with 401. A cookie that no longer resolves (expired, revoked, user
 * deleted) is cleared so the browser stops sending it.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    return sendError(reply, 401, 'unauthenticated', 'Sign in to continue.') as unknown as void;
  }

  const context = await resolveSession(token);
  if (!context) {
    clearSessionCookie(reply);
    return sendError(reply, 401, 'unauthenticated', 'Your session has expired.') as unknown as void;
  }

  // A suspended account (admin action, see routes/admin.ts) loses access
  // immediately even if this particular session predates the suspension —
  // revokeAllSessions is also called at suspend time, but this check is what
  // catches a request already in flight or a cookie resolved a moment later.
  if (context.user.disabledAt) {
    clearSessionCookie(reply);
    return sendError(
      reply,
      403,
      'account_disabled',
      'This account has been suspended.',
    ) as unknown as void;
  }

  request.user = context.user;
  request.sessionId = context.sessionId;
}

/** Narrowed accessor for handlers running behind `requireAuth`. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) {
    throw new Error('currentUser() called on a route without the requireAuth preHandler');
  }
  return request.user;
}

/**
 * preHandler for admin-only routes. Composed as `[requireAuth, assertAdmin]`
 * rather than folded into `requireAuth` itself, so every non-admin route is
 * unaffected and `currentUser()` keeps working the same way everywhere.
 *
 * Deliberately answers 403, not 404, unlike the ownership check documented in
 * routes/resumes.ts. That 404 exists to avoid confirming another user's row
 * exists; here the route's existence isn't a secret, and a 404 would leave
 * the admin UI unable to distinguish "gone" from "not allowed".
 */
async function assertAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (currentUser(request).role !== 'admin') {
    sendError(reply, 403, 'forbidden', 'Admin access required.');
  }
}

export const requireAdmin = [requireAuth, assertAdmin];
