import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '../db/client.js';
import {userSettings} from '../db/schema.js';
import {toApiSettings} from '../lib/domain.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {writeLimit, type DomainRoutesOptions} from '../lib/route-options.js';
import {updateSettingsSchema} from '../lib/validation.js';
import {currentUser, requireAuth} from '../plugins/auth.js';

/**
 * The four settings keys of StoreSnapshot. The row is created alongside the
 * user (see createUser), so these only ever read and update it.
 */
export async function settingsRoutes(
  app: FastifyInstance,
  options: DomainRoutesOptions = {},
): Promise<void> {
  const limit = writeLimit(options);

  app.get('/api/settings', {preHandler: requireAuth}, async (request, reply) => {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, currentUser(request).id))
      .limit(1);

    if (!row) return sendError(reply, 404, 'not_found', 'Settings are missing for this account.');
    return reply.send({settings: toApiSettings(row)});
  });

  /**
   * PATCH rather than the PUT the plan sketched: the desktop StorageService
   * saves each key independently, so requiring a caller to resend all four to
   * change one would both waste bandwidth and open a lost-update race between
   * two tabs editing different keys.
   */
  app.patch('/api/settings', {preHandler: requireAuth, config: limit}, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const [row] = await db
      .update(userSettings)
      .set({...parsed.data, updatedAt: new Date()})
      .where(eq(userSettings.userId, currentUser(request).id))
      .returning();

    if (!row) return sendError(reply, 404, 'not_found', 'Settings are missing for this account.');
    return reply.send({settings: toApiSettings(row)});
  });
}
