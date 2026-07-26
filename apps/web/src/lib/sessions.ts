import {and, eq, gt, lt} from 'drizzle-orm';
import type {FastifyReply, FastifyRequest} from 'fastify';
import {db} from '../db/client.js';
import {sessions, users, type User} from '../db/schema.js';
import {config} from '../config.js';
import {generateToken, hashToken} from './crypto.js';

export const SESSION_COOKIE = 'rr_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Sliding window: refresh the expiry once a session is past half its life. */
const SESSION_REFRESH_AFTER_MS = SESSION_TTL_MS / 2;

export interface SessionContext {
  user: User;
  sessionId: string;
}

export async function createSession(
  userId: string,
  request: FastifyRequest,
): Promise<{token: string; expiresAt: Date}> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: request.headers['user-agent']?.slice(0, 512),
    ip: request.ip,
  });

  return {token, expiresAt};
}

/** Resolves a cookie token to its user, refreshing the sliding expiry. */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const id = hashToken(token);

  const [row] = await db
    .select({session: sessions, user: users})
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;

  const now = new Date();
  const age = now.getTime() - row.session.createdAt.getTime();
  const updates: Partial<typeof sessions.$inferInsert> = {lastSeenAt: now};
  if (age > SESSION_REFRESH_AFTER_MS) {
    updates.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  }
  await db.update(sessions).set(updates).where(eq(sessions.id, id));

  return {user: row.user, sessionId: id};
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** "Sign out everywhere" — drops every session belonging to the user. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    domain: config.cookieDomain,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {path: '/', domain: config.cookieDomain});
}
