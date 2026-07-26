import {desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {config} from '../config.js';
import {db} from '../db/client.js';
import {resumes, scoreHistory, userSettings, users} from '../db/schema.js';
import {verifyPassword} from '../lib/crypto.js';
import {issueEmailToken} from '../lib/email-tokens.js';
import {sendAccountExistsEmail, sendEmailChangeEmail, sendInBackground} from '../lib/email.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {clearSessionCookie} from '../lib/sessions.js';
import {findUserByEmail, toPublicUser} from '../lib/users.js';
import {deleteAccountSchema, updateProfileSchema} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

export interface UserRoutesOptions {
  /** Overrides config.rateLimit.authMax; tests use it to isolate throttling. */
  rateLimitMax?: number;
}

/**
 * Account management for the signed-in user. The email-change flow starts here
 * but is completed by GET /api/auth/confirm-email-change, which owns the
 * token-to-redirect pattern shared with email verification.
 */
export async function userRoutes(
  app: FastifyInstance,
  options: UserRoutesOptions = {},
): Promise<void> {
  /** Throttle for endpoints that send mail or check a password. */
  const strictLimit = {
    rateLimit: {
      max: options.rateLimitMax ?? config.rateLimit.authMax,
      timeWindow: config.rateLimit.authWindow,
    },
  };

  const sendMail = (task: Promise<void>, context: string): void =>
    sendInBackground(app.log, task, context);

  app.get('/api/users/me', {preHandler: requireAuth}, async (request, reply) => {
    return reply.send({user: toPublicUser(currentUser(request))});
  });

  app.patch(
    '/api/users/me',
    {preHandler: requireAuth, config: strictLimit},
    async (request, reply) => {
      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const user = currentUser(request);
      const {name, email} = parsed.data;
      const updates: Partial<typeof users.$inferInsert> = {updatedAt: new Date()};

      if (name !== undefined) updates.name = name;

      // Submitting the address the account already has cancels any pending
      // change rather than starting a new one.
      const wantsNewEmail = email !== undefined && email.toLowerCase() !== user.email.toLowerCase();
      if (email !== undefined) updates.pendingEmail = wantsNewEmail ? email : null;

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning();

      if (wantsNewEmail) {
        const taken = await findUserByEmail(email);
        if (taken) {
          // Same anti-enumeration stance as registration: the response never
          // reveals that an address is in use. No token is issued, so the
          // confirmation link simply never arrives and the real owner is told
          // instead. The unique index is the backstop at confirmation time.
          sendMail(sendAccountExistsEmail(taken.email), 'email-change-collision');
        } else {
          const token = await issueEmailToken(user.id, 'change_email');
          sendMail(sendEmailChangeEmail(email, token), 'email-change');
        }
      }

      return reply.send({user: toPublicUser(updated), emailChangePending: wantsNewEmail});
    },
  );

  app.delete(
    '/api/users/me',
    {preHandler: requireAuth, config: strictLimit},
    async (request, reply) => {
      const parsed = deleteAccountSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const user = currentUser(request);
      if (!(await verifyPassword(user.passwordHash, parsed.data.password))) {
        return sendError(reply, 401, 'invalid_credentials', 'Your password is incorrect.');
      }

      // Sessions, email tokens, resumes, settings and history all cascade from
      // the users row, so this one delete removes everything.
      await db.delete(users).where(eq(users.id, user.id));
      clearSessionCookie(reply);

      return reply.send({ok: true});
    },
  );

  /**
   * Full data export. Columns are listed explicitly rather than selecting the
   * whole row so a future internal column cannot leak into the archive by
   * accident, and so `user_id` is not repeated on every record.
   */
  app.get('/api/users/me/export', {preHandler: requireAuth}, async (request, reply) => {
    const user = currentUser(request);

    const [settings] = await db
      .select({
        stopwords: userSettings.stopwords,
        termBoosts: userSettings.termBoosts,
        missingKeywordSettings: userSettings.missingKeywordSettings,
        preferenceMismatchSettings: userSettings.preferenceMismatchSettings,
        updatedAt: userSettings.updatedAt,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id));

    const userResumes = await db
      .select({
        id: resumes.id,
        filename: resumes.filename,
        text: resumes.text,
        terms: resumes.terms,
        uploadedAt: resumes.uploadedAt,
        isActive: resumes.isActive,
      })
      .from(resumes)
      .where(eq(resumes.userId, user.id))
      .orderBy(desc(resumes.uploadedAt));

    const history = await db
      .select({
        id: scoreHistory.id,
        resumeId: scoreHistory.resumeId,
        resumeFilename: scoreHistory.resumeFilename,
        jobTitle: scoreHistory.jobTitle,
        jobDescription: scoreHistory.jobDescription,
        score: scoreHistory.score,
        result: scoreHistory.result,
        createdAt: scoreHistory.createdAt,
      })
      .from(scoreHistory)
      .where(eq(scoreHistory.userId, user.id))
      .orderBy(desc(scoreHistory.createdAt));

    const filename = `resurank-export-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('content-disposition', `attachment; filename="${filename}"`);

    return reply.send({
      exportedAt: new Date().toISOString(),
      user: toPublicUser(user),
      settings: settings ?? null,
      resumes: userResumes,
      history,
    });
  });
}
