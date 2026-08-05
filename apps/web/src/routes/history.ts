import {and, desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {JOB_DESCRIPTION_CHAR_CAP, type MatchResult} from '@resurank/scoring';
import {db} from '../db/client.js';
import {resumes, scoreHistory} from '../db/schema.js';
import type {ApiHistoryEntry, ApiHistorySummary} from '../lib/domain.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {writeLimit, type DomainRoutesOptions} from '../lib/route-options.js';
import {createHistorySchema, historyQuerySchema, idParamSchema} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

/** List columns: everything except the two heavy ones. */
const summaryColumns = {
  id: scoreHistory.id,
  resumeId: scoreHistory.resumeId,
  resumeFilename: scoreHistory.resumeFilename,
  jobTitle: scoreHistory.jobTitle,
  score: scoreHistory.score,
  // Carried on the summary, unlike the rest of the provenance, so the list can
  // mark rows scored with a different model than the one loaded now — the
  // reason a stored score may not be comparable is worth seeing without
  // opening each row.
  embeddingModel: scoreHistory.embeddingModel,
  createdAt: scoreHistory.createdAt,
};

type SummaryRow = {
  id: string;
  resumeId: string | null;
  resumeFilename: string | null;
  jobTitle: string;
  score: number;
  embeddingModel: string | null;
  createdAt: Date;
};

function toSummary(row: SummaryRow): ApiHistorySummary {
  return {
    id: row.id,
    resumeId: row.resumeId,
    resumeFilename: row.resumeFilename,
    jobTitle: row.jobTitle,
    score: row.score,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Scoring history. The list returns summaries and the full job description and
 * result come from `GET /api/history/:id`: a history screen renders title,
 * score and date, and shipping every stored MatchResult to draw that list would
 * dwarf the page itself.
 */
export async function historyRoutes(
  app: FastifyInstance,
  options: DomainRoutesOptions = {},
): Promise<void> {
  const limit = writeLimit(options);

  app.get('/api/history', {preHandler: requireAuth}, async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {limit: take, offset, resumeId} = parsed.data;
    const userId = currentUser(request).id;
    const scope = resumeId
      ? and(eq(scoreHistory.userId, userId), eq(scoreHistory.resumeId, resumeId))
      : eq(scoreHistory.userId, userId);

    const rows = await db
      .select(summaryColumns)
      .from(scoreHistory)
      .where(scope)
      .orderBy(desc(scoreHistory.createdAt))
      .limit(take)
      .offset(offset);

    return reply.send({history: rows.map(toSummary), limit: take, offset});
  });

  app.get('/api/history/:id', {preHandler: requireAuth}, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const [row] = await db
      .select()
      .from(scoreHistory)
      .where(
        and(eq(scoreHistory.id, parsed.data.id), eq(scoreHistory.userId, currentUser(request).id)),
      )
      .limit(1);

    if (!row) return sendError(reply, 404, 'not_found', 'No such history entry.');

    const entry: ApiHistoryEntry = {
      ...toSummary(row),
      jobDescription: row.jobDescription,
      result: row.result,
      embeddingDtype: row.embeddingDtype,
      scoringVersion: row.scoringVersion,
    };
    return reply.send({entry});
  });

  app.post('/api/history', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = createHistorySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {resumeId, jobTitle, jobDescription, result, embeddingModel, embeddingDtype, scoringVersion} =
      parsed.data;
    if (jobDescription.length > JOB_DESCRIPTION_CHAR_CAP) {
      return sendError(
        reply,
        413,
        'payload_too_large',
        `Job description exceeds the ${JOB_DESCRIPTION_CHAR_CAP.toLocaleString('en-US')} character limit.`,
      );
    }

    const userId = currentUser(request).id;

    // The filename is denormalised from the resume rather than taken from the
    // request, so history cannot be labelled with a resume the caller does not
    // own — or one that never existed.
    let resumeFilename: string | null = null;
    if (resumeId) {
      const [resume] = await db
        .select({filename: resumes.filename})
        .from(resumes)
        .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
        .limit(1);

      if (!resume) return sendError(reply, 404, 'not_found', 'No such resume.');
      resumeFilename = resume.filename;
    }

    const [row] = await db
      .insert(scoreHistory)
      .values({
        userId,
        resumeId: resumeId ?? null,
        resumeFilename,
        jobTitle,
        jobDescription,
        // Denormalised from the result so history can be sorted without
        // unpacking jsonb; taken from `result` rather than accepted separately
        // so the column and the payload can never disagree.
        score: result.score,
        result: result as unknown as MatchResult,
        embeddingModel: embeddingModel ?? null,
        embeddingDtype: embeddingDtype ?? null,
        scoringVersion: scoringVersion ?? null,
      })
      .returning();

    return reply.code(201).send({
      entry: {
        ...toSummary(row),
        jobDescription,
        result: row.result,
        embeddingDtype: row.embeddingDtype,
        scoringVersion: row.scoringVersion,
      },
    });
  });

  app.delete('/api/history/:id', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const [deleted] = await db
      .delete(scoreHistory)
      .where(
        and(eq(scoreHistory.id, parsed.data.id), eq(scoreHistory.userId, currentUser(request).id)),
      )
      .returning({id: scoreHistory.id});

    if (!deleted) return sendError(reply, 404, 'not_found', 'No such history entry.');
    return reply.send({ok: true});
  });
}
