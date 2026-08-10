import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyReply} from 'fastify';
import {config} from '../config.js';
import {db} from '../db/client.js';
import {users} from '../db/schema.js';
import {getDummyHash, hashPassword, verifyPassword} from '../lib/crypto.js';
import {consumeEmailToken, issueEmailToken, revokeEmailTokens} from '../lib/email-tokens.js';
import {
  sendAccountExistsEmail,
  sendEmailChangedNotice,
  sendInBackground,
  sendPasswordChangedNotice,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../lib/email.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {
  clearSessionCookie,
  createSession,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
  SESSION_COOKIE,
} from '../lib/sessions.js';
import {findUserByEmail, createUser, toPublicUser} from '../lib/users.js';
import {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenQuerySchema,
} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

export interface AuthRoutesOptions {
  /** Overrides config.rateLimit.authMax; tests use it to isolate throttling. */
  rateLimitMax?: number;
}

/**
 * Registration and "resend verification" always return this, whether or not the
 * address is already in use. Anything more specific turns the endpoint into a
 * user-enumeration oracle; the real account holder is told by email instead.
 */
const GENERIC_EMAIL_SENT = {
  ok: true,
  message: 'If that email can be registered, a verification link is on its way.',
};

/** Same reasoning as GENERIC_EMAIL_SENT, for the forgot-password endpoint. */
const GENERIC_RESET_SENT = {
  ok: true,
  message: 'If that email has an account, a reset link is on its way.',
};

export async function authRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions = {},
): Promise<void> {
  /** Throttle for endpoints that send mail or check credentials. */
  const strictLimit = {
    rateLimit: {
      max: options.rateLimitMax ?? config.rateLimit.authMax,
      timeWindow: config.rateLimit.authWindow,
    },
  };

  const sendMail = (task: Promise<void>, context: string): void =>
    sendInBackground(app.log, task, context);

  app.post('/api/auth/register', {config: strictLimit}, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {email, password, name} = parsed.data;
    const existing = await findUserByEmail(email);

    if (existing) {
      sendMail(sendAccountExistsEmail(existing.email), 'account-exists');
      return reply.send(GENERIC_EMAIL_SENT);
    }

    const user = await createUser(email, password, name);
    const token = await issueEmailToken(user.id, 'verify');
    sendMail(sendVerificationEmail(user.email, token), 'verify');

    return reply.send(GENERIC_EMAIL_SENT);
  });

  app.get('/api/auth/verify-email', async (request, reply) => {
    const parsed = tokenQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.redirect(`${config.publicUrl}/verify-email?status=invalid`);
    }

    const userId = await consumeEmailToken(parsed.data.token, 'verify');
    if (!userId) {
      return reply.redirect(`${config.publicUrl}/verify-email?status=invalid`);
    }

    await db
      .update(users)
      .set({emailVerified: true, updatedAt: new Date()})
      .where(eq(users.id, userId));

    // Redirects rather than returning JSON: this URL is opened from an email
    // client, so the user must land on a real page.
    return reply.redirect(`${config.publicUrl}/verify-email?status=success`);
  });

  app.post('/api/auth/resend-verification', {config: strictLimit}, async (request, reply) => {
    const parsed = emailOnlySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const user = await findUserByEmail(parsed.data.email);
    if (user && !user.emailVerified) {
      const token = await issueEmailToken(user.id, 'verify');
      sendMail(sendVerificationEmail(user.email, token), 'verify-resend');
    }

    return reply.send(GENERIC_EMAIL_SENT);
  });

  app.post('/api/auth/forgot-password', {config: strictLimit}, async (request, reply) => {
    const parsed = emailOnlySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const user = await findUserByEmail(parsed.data.email);
    if (user) {
      const token = await issueEmailToken(user.id, 'reset');
      sendMail(sendPasswordResetEmail(user.email, token), 'reset');
    }

    return reply.send(GENERIC_RESET_SENT);
  });

  app.post('/api/auth/reset-password', {config: strictLimit}, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const userId = await consumeEmailToken(parsed.data.token, 'reset');
    if (!userId) {
      return sendError(reply, 400, 'invalid_token', 'This reset link is invalid or has expired.');
    }

    const [user] = await db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.password),
        // Clicking a link in the inbox proves exactly what verification proves,
        // so an unverified account is not left stranded after a reset.
        emailVerified: true,
        // Cancel any email change requested from a session that is about to be
        // revoked; otherwise an attacker who held one could still click their
        // confirmation link after being locked out and steal the address.
        // Cancel any email change requested from a session that is about to be
        // revoked; otherwise an attacker who held one could still click their
        // confirmation link after being locked out and steal the address.
        pendingEmail: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    // A reset is the recovery path after a suspected compromise: every session
    // dies, including any an attacker is holding.
    await revokeAllSessions(userId);
    await revokeEmailTokens(userId, 'change_email');
    clearSessionCookie(reply);
    sendMail(sendPasswordChangedNotice(user.email), 'password-reset-notice');

    // Deliberately does not sign the user in — they re-enter the new password.
    return reply.send({ok: true, message: 'Your password has been reset. Sign in to continue.'});
  });

  app.post(
    '/api/auth/change-password',
    {preHandler: requireAuth, config: strictLimit},
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const user = currentUser(request);
      if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
        return sendError(reply, 401, 'invalid_credentials', 'Your current password is incorrect.');
      }

      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(parsed.data.newPassword),
          // Same reasoning as the reset path: changing the password is how a
          // user reacts to a suspected intrusion, so it cancels any email
          // change that intrusion may have queued up.
          pendingEmail: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Drop every session, then hand this device a fresh one: other devices
      // are signed out and the pre-change token is no longer replayable, but
      // the user who just changed their password stays signed in here.
      await revokeAllSessions(user.id);
      await revokeEmailTokens(user.id, 'change_email');
      const {token, expiresAt} = await createSession(user.id, request);
      setSessionCookie(reply, token, expiresAt);
      sendMail(sendPasswordChangedNotice(user.email), 'password-changed-notice');

      return reply.send({
        ok: true,
        message: 'Password updated. Other devices have been signed out.',
      });
    },
  );

  /**
   * Opened from the link mailed to the *new* address by PATCH /api/users/me.
   * Redirects rather than returning JSON, for the same reason verify-email does.
   */
  app.get('/api/auth/confirm-email-change', async (request, reply) => {
    const landing = (status: string): FastifyReply =>
      reply.redirect(`${config.publicUrl}/account?email=${status}`);

    const parsed = tokenQuerySchema.safeParse(request.query);
    if (!parsed.success) return landing('invalid');

    const userId = await consumeEmailToken(parsed.data.token, 'change_email');
    if (!userId) return landing('invalid');

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.pendingEmail) return landing('invalid');

    const previousEmail = user.email;
    const newEmail = user.pendingEmail;

    try {
      await db
        .update(users)
        .set({email: newEmail, pendingEmail: null, emailVerified: true, updatedAt: new Date()})
        .where(eq(users.id, userId));
    } catch (error) {
      // users_email_lower_unique — someone else claimed the address between
      // the request and the click.
      app.log.warn({error, userId}, 'email change collided with an existing account');
      return landing('taken');
    }

    sendMail(sendEmailChangedNotice(previousEmail, newEmail), 'email-changed-notice');
    return landing('changed');
  });

  app.post('/api/auth/login', {config: strictLimit}, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {email, password} = parsed.data;
    const user = await findUserByEmail(email);

    if (!user) {
      // Burn comparable CPU on a throwaway hash so response time does not
      // reveal whether the address exists.
      await verifyPassword(await getDummyHash(), password);
      return sendError(reply, 401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      return sendError(reply, 401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    if (!user.emailVerified) {
      return sendError(
        reply,
        403,
        'email_not_verified',
        'Verify your email address before signing in.',
      );
    }

    // Suspending a user (routes/admin.ts) revokes their sessions at that
    // moment, but nothing stops them from logging in again afterward and
    // minting a fresh one — check here rather than relying solely on
    // requireAuth's disabledAt check to catch it on their next request.
    if (user.disabledAt) {
      return sendError(reply, 403, 'account_disabled', 'This account has been suspended.');
    }

    const {token, expiresAt} = await createSession(user.id, request);
    setSessionCookie(reply, token, expiresAt);

    return reply.send({user: toPublicUser(user)});
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token);
    clearSessionCookie(reply);
    return reply.send({ok: true});
  });

  app.post('/api/auth/logout-all', {preHandler: requireAuth}, async (request, reply) => {
    await revokeAllSessions(currentUser(request).id);
    clearSessionCookie(reply);
    return reply.send({ok: true});
  });

  /** Cheap "am I signed in?" check for the SPA on boot. */
  app.get('/api/auth/session', {preHandler: requireAuth}, async (request, reply) => {
    return reply.send({user: toPublicUser(currentUser(request))});
  });
}
