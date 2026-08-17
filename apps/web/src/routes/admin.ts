import {and, count, desc, eq, ilike, isNotNull, isNull, max, or, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {config} from '../config.js';
import {db} from '../db/client.js';
import {adminAuditLog, resumes, scoreHistory, sessions, settingsVersions, users,} from '../db/schema.js';
import {checkActingPassword, checkAdminQuorum, checkNotSelf,} from '../lib/admin-guards.js';
import {recordAdminAction} from '../lib/audit.js';
import {revokeAllSessions} from '../lib/sessions.js';
import {sendError, sendValidationError} from '../lib/errors.js';
import {type DomainRoutesOptions, writeLimit} from '../lib/route-options.js';
import {
  adminAuditQuerySchema,
  adminDeleteSchema,
  adminRoleSchema,
  adminStatusSchema,
  adminUserQuerySchema,
  idParamSchema,
} from '../lib/validation.js';
import {currentUser, requireAdmin} from '../plugins/auth.js';
import {exportUserData, toPublicUser} from '../lib/users.js';

/**
 * Admin-only account management: list/search/inspect/suspend/delete users,
 * grant or revoke admin, and read the audit trail those actions write. Every
 * route here sits behind `requireAdmin` (requireAuth + role check).
 */
export async function adminRoutes(
  app: FastifyInstance,
  options: DomainRoutesOptions = {},
): Promise<void> {
  const limit = writeLimit(options);

  const strictLimit = {
    rateLimit: {
      max: options.rateLimitMax ?? config.rateLimit.authMax,
      timeWindow: config.rateLimit.authWindow,
    },
  };

  app.get('/api/admin/stats', {preHandler: requireAdmin}, async (_request, reply) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [userCounts] = await db
      .select({
        total: count(),
        admins: count(sql`case when ${users.role} = 'admin' then 1 end`),
        suspended: count(sql`case when ${users.disabledAt} is not null then 1 end`),
        signupsLast7Days: count(sql`case when ${users.createdAt} >= ${sevenDaysAgo} then 1 end`),
        signupsLast30Days: count(
          sql`case when ${users.createdAt} >= ${thirtyDaysAgo} then 1 end`,
        ),
      })
      .from(users);

    const [[resumeCounts], [historyCounts]] = await Promise.all([
      db.select({total: count()}).from(resumes),
      db.select({total: count()}).from(scoreHistory),
    ]);

    return reply.send({
      users: userCounts,
      resumes: resumeCounts.total,
      scores: historyCounts.total,
    });
  });

  app.get('/api/admin/users', {preHandler: requireAdmin}, async (request, reply) => {
    const parsed = adminUserQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const {limit: pageLimit, offset, q, status} = parsed.data;

    const filters = [];
    if (q) {
      filters.push(or(ilike(users.email, `${q}%`), ilike(users.name, `%${q}%`)));
    }
    if (status === 'active') filters.push(isNull(users.disabledAt));
    else if (status === 'suspended') filters.push(isNotNull(users.disabledAt));
    else if (status === 'admin') filters.push(eq(users.role, 'admin'));

    const where = filters.length > 0 ? and(...filters) : undefined;

    const lastSeen = db
      .select({userId: sessions.userId, lastSeenAt: max(sessions.lastSeenAt).as('last_seen_at')})
      .from(sessions)
      .groupBy(sessions.userId)
      .as('last_seen');

    const resumeCounts = db
      .select({userId: resumes.userId, count: count().as('resume_count')})
      .from(resumes)
      .groupBy(resumes.userId)
      .as('resume_counts');

    const historyCounts = db
      .select({userId: scoreHistory.userId, count: count().as('history_count')})
      .from(scoreHistory)
      .groupBy(scoreHistory.userId)
      .as('history_counts');

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          user: users,
          resumeCount: sql<number>`coalesce(${resumeCounts.count}, 0)`,
          historyCount: sql<number>`coalesce(${historyCounts.count}, 0)`,
          lastSeenAt: lastSeen.lastSeenAt,
        })
        .from(users)
        .leftJoin(resumeCounts, eq(resumeCounts.userId, users.id))
        .leftJoin(historyCounts, eq(historyCounts.userId, users.id))
        .leftJoin(lastSeen, eq(lastSeen.userId, users.id))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageLimit)
        .offset(offset),
      db.select({total: count()}).from(users).where(where),
    ]);

    return reply.send({
      users: rows.map((row) => ({
        ...toPublicUser(row.user),
        resumeCount: Number(row.resumeCount),
        historyCount: Number(row.historyCount),
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      })),
      total: totalRow.total,
    });
  });

  app.get('/api/admin/users/:id', {preHandler: requireAdmin}, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

    const [target] = await db.select().from(users).where(eq(users.id, parsedParams.data.id));
    if (!target) return sendError(reply, 404, 'not_found', 'User not found.');

    const [[resumeCount], [historyCount], [settingsVersionCount], userSessions] =
      await Promise.all([
        db.select({total: count()}).from(resumes).where(eq(resumes.userId, target.id)),
        db.select({total: count()}).from(scoreHistory).where(eq(scoreHistory.userId, target.id)),
        db
          .select({total: count()})
          .from(settingsVersions)
          .where(eq(settingsVersions.userId, target.id)),
        db
          .select({
            id: sessions.id,
            ip: sessions.ip,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            lastSeenAt: sessions.lastSeenAt,
            expiresAt: sessions.expiresAt,
          })
          .from(sessions)
          .where(eq(sessions.userId, target.id))
          .orderBy(desc(sessions.lastSeenAt)),
      ]);

    return reply.send({
      user: toPublicUser(target),
      resumeCount: resumeCount.total,
      historyCount: historyCount.total,
      settingsVersionCount: settingsVersionCount.total,
      sessions: userSessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    });
  });

  app.get(
    '/api/admin/users/:id/export',
    {preHandler: requireAdmin},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

      const [target] = await db.select().from(users).where(eq(users.id, parsedParams.data.id));
      if (!target) return sendError(reply, 404, 'not_found', 'User not found.');

      const data = await exportUserData(target);
      const filename = `resurank-export-${target.id}-${new Date().toISOString().slice(0, 10)}.json`;
      reply.header('content-disposition', `attachment; filename="${filename}"`);
      return reply.send(data);
    },
  );

  app.patch(
    '/api/admin/users/:id/role',
    {preHandler: requireAdmin, config: strictLimit},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
      const parsedBody = adminRoleSchema.safeParse(request.body);
      if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

      const actor = currentUser(request);
      const targetId = parsedParams.data.id;
      const {role, password} = parsedBody.data;

      const selfErr = checkNotSelf(actor, targetId);
      if (selfErr) return sendError(reply, selfErr.status, selfErr.code, selfErr.message);

      const passwordErr = await checkActingPassword(actor, password);
      if (passwordErr) {
        return sendError(reply, passwordErr.status, passwordErr.code, passwordErr.message);
      }

      const result = await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, targetId));
        if (!target) {
          return {ok: false, status: 404, code: 'not_found', message: 'User not found.'} as const;
        }

        // Demoting an admin can trip the quorum guard; promoting a user never
        // can, so the check only matters (and only runs a lock) when it does.
        if (target.role === 'admin' && role === 'user') {
          const quorumErr = await checkAdminQuorum(tx, targetId);
          if (quorumErr) return {ok: false, ...quorumErr} as const;
        }

        const [updated] = await tx
          .update(users)
          .set({role, updatedAt: new Date()})
          .where(eq(users.id, targetId))
          .returning();

        await recordAdminAction(
          {
            actorId: actor.id,
            actorEmail: actor.email,
            targetId: updated.id,
            targetEmail: updated.email,
            action: role === 'admin' ? 'grant_admin' : 'revoke_admin',
            detail: {previousRole: target.role},
            ip: request.ip,
          },
          tx,
        );

        return {ok: true, user: updated} as const;
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return reply.send({user: toPublicUser(result.user)});
    },
  );

  app.patch(
    '/api/admin/users/:id/status',
    {preHandler: requireAdmin, config: strictLimit},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
      const parsedBody = adminStatusSchema.safeParse(request.body);
      if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

      const actor = currentUser(request);
      const targetId = parsedParams.data.id;
      const {disabled, password} = parsedBody.data;

      const selfErr = checkNotSelf(actor, targetId);
      if (selfErr) return sendError(reply, selfErr.status, selfErr.code, selfErr.message);

      const passwordErr = await checkActingPassword(actor, password);
      if (passwordErr) {
        return sendError(reply, passwordErr.status, passwordErr.code, passwordErr.message);
      }

      const result = await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, targetId));
        if (!target) {
          return {ok: false, status: 404, code: 'not_found', message: 'User not found.'} as const;
        }

        if (disabled) {
          const quorumErr = await checkAdminQuorum(tx, targetId);
          if (quorumErr) return {ok: false, ...quorumErr} as const;
        }

        const [updated] = await tx
          .update(users)
          .set({disabledAt: disabled ? new Date() : null, updatedAt: new Date()})
          .where(eq(users.id, targetId))
          .returning();

        await recordAdminAction(
          {
            actorId: actor.id,
            actorEmail: actor.email,
            targetId: updated.id,
            targetEmail: updated.email,
            action: disabled ? 'suspend_user' : 'reinstate_user',
          },
          tx,
        );

        return {ok: true, user: updated} as const;
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }

      // Outside the transaction: cutting off in-flight sessions is a safe,
      // idempotent follow-up rather than something that needs to roll back
      // together with the role/status write.
      if (disabled) await revokeAllSessions(result.user.id);

      return reply.send({user: toPublicUser(result.user)});
    },
  );

  app.post(
    '/api/admin/users/:id/verify-email',
    {preHandler: requireAdmin, config: limit},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

      const actor = currentUser(request);
      const [target] = await db
        .update(users)
        .set({emailVerified: true, pendingEmail: null, updatedAt: new Date()})
        .where(eq(users.id, parsedParams.data.id))
        .returning();
      if (!target) return sendError(reply, 404, 'not_found', 'User not found.');

      await recordAdminAction({
        actorId: actor.id,
        actorEmail: actor.email,
        targetId: target.id,
        targetEmail: target.email,
        action: 'force_verify',
        ip: request.ip,
      });

      return reply.send({user: toPublicUser(target)});
    },
  );

  app.post(
    '/api/admin/users/:id/revoke-sessions',
    {preHandler: requireAdmin, config: limit},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);

      const actor = currentUser(request);
      const [target] = await db.select().from(users).where(eq(users.id, parsedParams.data.id));
      if (!target) return sendError(reply, 404, 'not_found', 'User not found.');

      await revokeAllSessions(target.id);
      await recordAdminAction({
        actorId: actor.id,
        actorEmail: actor.email,
        targetId: target.id,
        targetEmail: target.email,
        action: 'revoke_sessions',
        ip: request.ip,
      });

      return reply.send({ok: true});
    },
  );

  app.delete(
    '/api/admin/users/:id',
    {preHandler: requireAdmin, config: strictLimit},
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) return sendValidationError(reply, parsedParams.error);
      const parsedBody = adminDeleteSchema.safeParse(request.body);
      if (!parsedBody.success) return sendValidationError(reply, parsedBody.error);

      const actor = currentUser(request);
      const targetId = parsedParams.data.id;

      const selfErr = checkNotSelf(actor, targetId);
      if (selfErr) return sendError(reply, selfErr.status, selfErr.code, selfErr.message);

      const passwordErr = await checkActingPassword(actor, parsedBody.data.password);
      if (passwordErr) {
        return sendError(reply, passwordErr.status, passwordErr.code, passwordErr.message);
      }

      const result = await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, targetId));
        if (!target) {
          return {ok: false, status: 404, code: 'not_found', message: 'User not found.'} as const;
        }

        const quorumErr = await checkAdminQuorum(tx, targetId);
        if (quorumErr) return {ok: false, ...quorumErr} as const;

        // Sessions, email tokens, resumes, settings, settings_versions and
        // history all cascade from the users row, matching DELETE /api/users/me.
        await tx.delete(users).where(eq(users.id, targetId));

        await recordAdminAction(
          {
            actorId: actor.id,
            actorEmail: actor.email,
            targetId: target.id,
            targetEmail: target.email,
            action: 'delete_user',
          },
          tx,
        );

        return {ok: true} as const;
      });

      if (!result.ok) {
        return sendError(reply, result.status, result.code, result.message);
      }
      return reply.send({ok: true});
    },
  );

  app.get('/api/admin/audit', {preHandler: requireAdmin}, async (request, reply) => {
    const parsed = adminAuditQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const {limit: pageLimit, offset, targetId} = parsed.data;

    const where = targetId ? eq(adminAuditLog.targetId, targetId) : undefined;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(adminAuditLog)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(pageLimit)
        .offset(offset),
      db.select({total: count()}).from(adminAuditLog).where(where),
    ]);

    return reply.send({
      entries: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        targetId: row.targetId,
        targetEmail: row.targetEmail,
        action: row.action,
        detail: row.detail,
        createdAt: row.createdAt.toISOString(),
      })),
      total: totalRow.total,
    });
  });
}
