import {and, count, desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {JOB_DESCRIPTION_CHAR_CAP, type MatchResult} from '@resurank/scoring';
import {db} from '../db/client.js';
import {resumes, scoreHistory, settingsVersions, userSettings} from '../db/schema.js';
import type {ApiHistoryEntry, ApiHistorySummary, ApiSettings} from '../lib/domain.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {hashSettings, type SettingsPayload} from '../lib/settings-hash.js';
import {type DomainRoutesOptions, writeLimit} from '../lib/route-options.js';
import {createHistorySchema, historyQuerySchema, idParamSchema} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

/**
 * Ceiling on the serialized size of `result` (a `MatchResult` from
 * @resurank/scoring, accepted as `.passthrough()`
 */
export const MATCH_RESULT_MAX_BYTES = 512 * 1024;

/**
 * Ceiling on how many history rows one account can hold.
 */
export const MAX_HISTORY_ROWS_PER_USER = 5_000;

/** List columns: everything except the two heavy ones. */
const summaryColumns = {
  id: scoreHistory.id,
  resumeId: scoreHistory.resumeId,
  resumeFilename: scoreHistory.resumeFilename,
  jobTitle: scoreHistory.jobTitle,
  score: scoreHistory.score,
  embeddingModel: scoreHistory.embeddingModel,
  scoringVersion: scoreHistory.scoringVersion,
  settingsVersionId: scoreHistory.settingsVersionId,
  createdAt: scoreHistory.createdAt,
};

type SummaryRow = {
  id: string;
  resumeId: string | null;
  resumeFilename: string | null;
  jobTitle: string;
  score: number;
  embeddingModel: string | null;
  scoringVersion: string | null;
  settingsVersionId: string | null;
  createdAt: Date;
};

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

    return reply.send({
      history: rows.map(toSummary),
      limit: take,
      offset,
      // Sent with the list rather than fetched separately: every caller that
      // renders these rows needs it to tell a stale row from a current one.
      currentSettingsVersionId: await currentSettingsVersionId(userId),
    });
  });

  async function currentSettingsVersionId(userId: string): Promise<string | null> {
    const [settings] = await db
      .select({
        stopwords: userSettings.stopwords,
        termBoosts: userSettings.termBoosts,
        missingKeywordSettings: userSettings.missingKeywordSettings,
        preferenceMismatchSettings: userSettings.preferenceMismatchSettings,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (!settings) return null;

    const [row] = await db
      .select({id: settingsVersions.id})
      .from(settingsVersions)
      .where(
        and(eq(settingsVersions.userId, userId), eq(settingsVersions.hash, hashSettings(settings))),
      )
      .limit(1);
    return row?.id ?? null;
  }

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
      settings: row.settingsVersionId
        ? await settingsFor(row.settingsVersionId, row.userId)
        : null,
    };
    return reply.send({entry});
  });

  async function settingsFor(
    settingsVersionId: string,
    userId: string,
  ): Promise<ApiSettings | null> {
    const [row] = await db
      .select({
        stopwords: settingsVersions.stopwords,
        termBoosts: settingsVersions.termBoosts,
        missingKeywordSettings: settingsVersions.missingKeywordSettings,
        preferenceMismatchSettings: settingsVersions.preferenceMismatchSettings,
      })
      .from(settingsVersions)
      .where(and(eq(settingsVersions.id, settingsVersionId), eq(settingsVersions.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  app.post('/api/history', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = createHistorySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const {
      resumeId,
      jobTitle,
      jobDescription,
      result,
      embeddingModel,
      embeddingDtype,
      scoringVersion,
      settings,
    } = parsed.data;
    if (jobDescription.length > JOB_DESCRIPTION_CHAR_CAP) {
      return sendError(
        reply,
        413,
        'payload_too_large',
        `Job description exceeds the ${JOB_DESCRIPTION_CHAR_CAP.toLocaleString('en-US')} character limit.`,
      );
    }

    const resultBytes = Buffer.byteLength(JSON.stringify(result));
    if (resultBytes > MATCH_RESULT_MAX_BYTES) {
      return sendError(
        reply,
        413,
        'payload_too_large',
        `Match result exceeds the ${MATCH_RESULT_MAX_BYTES.toLocaleString('en-US')} byte limit.`,
      );
    }

    const userId = currentUser(request).id;
    const [{value: historyRowCount}] = await db
      .select({value: count()})
      .from(scoreHistory)
      .where(eq(scoreHistory.userId, userId));
    if (historyRowCount >= MAX_HISTORY_ROWS_PER_USER) {
      return sendError(
        reply,
        409,
        'conflict',
        `You have reached the limit of ${MAX_HISTORY_ROWS_PER_USER.toLocaleString('en-US')} saved history entries. Delete some before saving more.`,
      );
    }

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

    const settingsVersionId = settings ? await resolveSettingsVersionId(userId, settings) : null;

    const [row] = await db
      .insert(scoreHistory)
      .values({
        userId,
        resumeId: resumeId ?? null,
        resumeFilename,
        jobTitle,
        jobDescription,
        score: result.score,
        result: result as unknown as MatchResult,
        embeddingModel: embeddingModel ?? null,
        embeddingDtype: embeddingDtype ?? null,
        scoringVersion: scoringVersion ?? null,
        settingsVersionId,
      })
      .returning();

    return reply.code(201).send({
      entry: {
        ...toSummary(row),
        jobDescription,
        result: row.result,
        embeddingDtype: row.embeddingDtype,
      },
    });
  });

  async function resolveSettingsVersionId(
    userId: string,
    settings: SettingsPayload,
  ): Promise<string> {
    const hash = hashSettings(settings);

    const [existing] = await db
      .select({id: settingsVersions.id})
      .from(settingsVersions)
      .where(and(eq(settingsVersions.userId, userId), eq(settingsVersions.hash, hash)))
      .limit(1);
    if (existing) return existing.id;

    const [row] = await db
      .insert(settingsVersions)
      .values({
        userId,
        hash,
        stopwords: settings.stopwords,
        termBoosts: settings.termBoosts,
        missingKeywordSettings: settings.missingKeywordSettings,
        preferenceMismatchSettings: settings.preferenceMismatchSettings,
      })
      .onConflictDoUpdate({
        target: [settingsVersions.userId, settingsVersions.hash],
        set: {hash},
      })
      .returning({id: settingsVersions.id});

    return row.id;
  }
  
  function toSummary(row: SummaryRow): ApiHistorySummary {
    return {
      id: row.id,
      resumeId: row.resumeId,
      resumeFilename: row.resumeFilename,
      jobTitle: row.jobTitle,
      score: row.score,
      embeddingModel: row.embeddingModel,
      scoringVersion: row.scoringVersion,
      settingsVersionId: row.settingsVersionId,
      createdAt: row.createdAt.toISOString(),
    };
  }

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
