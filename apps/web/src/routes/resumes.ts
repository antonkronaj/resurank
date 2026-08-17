import {and, count, desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {RESUME_CHAR_CAP} from '@resurank/scoring';
import {db} from '../db/client.js';
import {resumes} from '../db/schema.js';
import {
  activateResume,
  lockUserForResumeWrite,
  resumeSummaryColumns,
  toApiResume,
  toResumeSummary,
} from '../lib/domain.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {createResumeSchema, idParamSchema} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';
import {type DomainRoutesOptions, writeLimit} from '../lib/route-options.js';

/**
 * Ceiling on how many resumes one account can hold. Only one is ever
 * "active" at a time, but nothing stops an account from uploading a fresh
 * one on every visit forever.
 */
export const MAX_RESUMES_PER_USER = 50;

/**
 * Resume CRUD. Only extracted text is ever stored
 */
export async function resumeRoutes(
  app: FastifyInstance,
  options: DomainRoutesOptions = {},
): Promise<void> {
  const limit = writeLimit(options);

  app.get('/api/resumes', {preHandler: requireAuth}, async (request, reply) => {
    const rows = await db
      .select(resumeSummaryColumns)
      .from(resumes)
      .where(eq(resumes.userId, currentUser(request).id))
      .orderBy(desc(resumes.uploadedAt));

    return reply.send({resumes: rows.map(toResumeSummary)});
  });

  app.get('/api/resumes/:id', {preHandler: requireAuth}, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const [row] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, parsed.data.id), eq(resumes.userId, currentUser(request).id)))
      .limit(1);

    if (!row) return sendError(reply, 404, 'not_found', 'No such resume.');
    return reply.send({resume: toApiResume(row)});
  });

  app.post('/api/resumes', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = createResumeSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {filename, text, terms} = parsed.data;
    if (text.length > RESUME_CHAR_CAP) {
      return sendError(
        reply,
        413,
        'payload_too_large',
        `Resume text exceeds the ${RESUME_CHAR_CAP.toLocaleString('en-US')} character limit.`,
      );
    }

    const userId = currentUser(request).id;

    // A freshly uploaded resume becomes the active one
    const row = await db.transaction(async (tx) => {
      await lockUserForResumeWrite(tx, userId);

      const [{value: resumeCount}] = await tx
        .select({value: count()})
        .from(resumes)
        .where(eq(resumes.userId, userId));
      if (resumeCount >= MAX_RESUMES_PER_USER) return null;

      await tx
        .update(resumes)
        .set({isActive: false})
        .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)));

      const [created] = await tx
        .insert(resumes)
        .values({userId, filename, text, terms, isActive: true})
        .returning();

      return created;
    });

    if (!row) {
      return sendError(
        reply,
        409,
        'conflict',
        `You have reached the limit of ${MAX_RESUMES_PER_USER.toLocaleString('en-US')} saved resumes. Delete some before uploading more.`,
      );
    }

    return reply.code(201).send({resume: toApiResume(row)});
  });

  app.put('/api/resumes/:id/active', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const userId = currentUser(request).id;
    const [owned] = await db
      .select({id: resumes.id})
      .from(resumes)
      .where(and(eq(resumes.id, parsed.data.id), eq(resumes.userId, userId)))
      .limit(1);

    if (!owned) return sendError(reply, 404, 'not_found', 'No such resume.');

    await db.transaction(async (tx) => {
      await lockUserForResumeWrite(tx, userId);
      await activateResume(tx, userId, owned.id);
    });

    return reply.send({ok: true, activeResumeId: owned.id});
  });

  app.delete('/api/resumes/:id', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const userId = currentUser(request).id;

    const activeResumeId = await db.transaction(async (tx) => {
      await lockUserForResumeWrite(tx, userId);

      const [deleted] = await tx
        .delete(resumes)
        .where(and(eq(resumes.id, parsed.data.id), eq(resumes.userId, userId)))
        .returning({id: resumes.id, wasActive: resumes.isActive});

      if (!deleted) return undefined;

      // Score history for this resume survives (the FK is ON DELETE SET NULL),
      // so past scores stay readable after the resume they used is gone.
      if (!deleted.wasActive) return null;

      // Deleting the active resume would otherwise leave the account with none
      // selected and nothing to score against; promote the next most recent.
      const [next] = await tx
        .select({id: resumes.id})
        .from(resumes)
        .where(eq(resumes.userId, userId))
        .orderBy(desc(resumes.uploadedAt))
        .limit(1);

      if (!next) return null;
      await activateResume(tx, userId, next.id);
      return next.id;
    });

    if (activeResumeId === undefined) return sendError(reply, 404, 'not_found', 'No such resume.');
    return reply.send({ok: true, activeResumeId});
  });
}
