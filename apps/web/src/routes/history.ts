import {and, desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {JOB_DESCRIPTION_CHAR_CAP, type MatchResult} from '@resurank/scoring';
import {db} from '../db/client.js';
import {resumes, scoreHistory, settingsVersions, userSettings} from '../db/schema.js';
import type {ApiHistoryEntry, ApiHistorySummary, ApiSettings} from '../lib/domain.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {hashSettings, type SettingsPayload} from '../lib/settings-hash.js';
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
  // Carried on the summary, unlike `embeddingDtype`, so the list can mark rows
  // scored with a different model or scoring engine than the ones loaded now —
  // the reason a stored score may not be comparable is worth seeing without
  // opening each row. Dtype stays detail-only: it never changes independently
  // of the model, so it adds nothing a list badge could act on.
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

/**
 * The `settings_versions` row for this exact settings state, created if this
 * user has not scored under it before.
 *
 * Read first, write only on a miss. Settings change far less often than scores
 * are taken, so nearly every call lands on the select — and an upsert on that
 * path is not free: `on conflict do update` is a real UPDATE, so it writes a
 * new row version, leaves a dead tuple and touches the unique index even when
 * nothing changed. Doing that once per score would keep an almost-static table
 * permanently in need of vacuuming.
 *
 * The insert still carries `on conflict do update` because the select-then
 * -insert gap is a genuine race: two first-ever scores under the same new
 * settings would both miss and then collide on the unique index. That path is
 * rare enough for the redundant write not to matter, and `do update` (rather
 * than `do nothing`) is what makes RETURNING yield the winning row instead of
 * nothing at all.
 *
 * Note this trusts the client's settings the same way `embeddingModel` is
 * trusted: scoring happens client-side, so the server has no independent copy
 * of what a given run actually used. Snapshotting the server's `user_settings`
 * instead would be worse, not better — those can already have moved on between
 * the score and this request.
 */
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

/**
 * The version row matching the user's *current* settings, or null when those
 * settings have never been scored under.
 *
 * Null is not an error: it means no stored score used what a re-score would use
 * now, so every row is legitimately "different settings". Comparing version ids
 * rather than hashes is sound for the same reason — a score taken under the
 * current settings would necessarily have created this row.
 */
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

/**
 * The settings a `settings_versions` row actually holds, for the detail
 * screen's read-only "what ran" display. Scoped by `userId` in addition to
 * the id — not because a stray id could realistically belong to someone else
 * (`resolveSettingsVersionId` only ever inserts under the caller's own
 * `userId`), but because the row is only reachable via a `score_history` row
 * already filtered to this user, and defense in depth costs nothing here
 * (see "will not label history with a resume the caller does not own" for the
 * same posture on `resumeId`).
 */
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

    return reply.send({
      history: rows.map(toSummary),
      limit: take,
      offset,
      // Sent with the list rather than fetched separately: every caller that
      // renders these rows needs it to tell a stale row from a current one.
      currentSettingsVersionId: await currentSettingsVersionId(userId),
    });
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
      settings: row.settingsVersionId
        ? await settingsFor(row.settingsVersionId, row.userId)
        : null,
    };
    return reply.send({entry});
  });

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

    const settingsVersionId = settings ? await resolveSettingsVersionId(userId, settings) : null;

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
