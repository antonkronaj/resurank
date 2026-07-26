import {and, desc, eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '../db/client.js';
import {resumes, userSettings} from '../db/schema.js';
import {
  resumeSummaryColumns,
  toApiResume,
  toApiSettings,
  toResumeSummary,
  type ApiResume,
  type ApiResumeSummary,
  type ApiSettings,
} from '../lib/domain.js';
import {sendError} from '../lib/errors.js';
import {toPublicUser, type PublicUser} from '../lib/users.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

/**
 * Everything the SPA needs to render its first frame, in one round trip.
 *
 * The payload is a superset of StoreSnapshot (frontend/src/app/storage.service.ts):
 * `resume` is the *active* resume in exactly the shape the desktop build's
 * single-resume getters expect, so the shared code path is unchanged, and
 * `resumes` carries the web-only list beside it. Without this, the five getters
 * that all funnel through StorageService.load() would each become a request.
 *
 * Scoring history is deliberately absent — it was never part of load(), it is
 * its own screen, and it is paginated at GET /api/history.
 */
export interface BootstrapResponse extends ApiSettings {
  user: PublicUser;
  resume: ApiResume | null;
  resumes: ApiResumeSummary[];
}

export async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/bootstrap', {preHandler: requireAuth}, async (request, reply) => {
    const user = currentUser(request);

    const [settingsRow, activeRows, summaryRows] = await Promise.all([
      db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1),
      db
        .select()
        .from(resumes)
        .where(and(eq(resumes.userId, user.id), eq(resumes.isActive, true)))
        .limit(1),
      db
        .select(resumeSummaryColumns)
        .from(resumes)
        .where(eq(resumes.userId, user.id))
        .orderBy(desc(resumes.uploadedAt)),
    ]);

    const settings = settingsRow[0];
    if (!settings) {
      return sendError(reply, 404, 'not_found', 'Settings are missing for this account.');
    }

    const response: BootstrapResponse = {
      user: toPublicUser(user),
      resume: activeRows[0] ? toApiResume(activeRows[0]) : null,
      resumes: summaryRows.map(toResumeSummary),
      ...toApiSettings(settings),
    };

    return reply.send(response);
  });
}
