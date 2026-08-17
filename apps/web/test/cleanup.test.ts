import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, describe, it} from 'node:test';
import {eq} from 'drizzle-orm';
import {closeDatabase, db} from '../src/db/client.js';
import {emailTokens, sessions, users} from '../src/db/schema.js';
import {runCleanup} from '../src/lib/cleanup.js';
import {hashPassword} from '../src/lib/crypto.js';
import {uniqueEmail} from './helpers/auth.js';

/**
 * Unit tests for lib/cleanup.ts against the real Postgres from
 * apps/web/docker-compose.yml. Start it first: npm --prefix apps/web run db:up
 *
 * Exercises deleteExpiredSessions/deleteExpiredEmailTokens directly through
 * runCleanup(), rather than through the HTTP surface — there is no HTTP
 * surface for this, it only ever runs from the scheduler in index.ts.
 */

after(async () => {
  await closeDatabase();
});

async function makeUser(label: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      email: uniqueEmail(label),
      passwordHash: await hashPassword('irrelevant-password'),
      emailVerified: true,
    })
    .returning({id: users.id});
  return user.id;
}

describe('runCleanup', () => {
  it('removes expired sessions and leaves live ones', async () => {
    const userId = await makeUser('cleanup-sessions');
    const expiredId = randomUUID();
    const liveId = randomUUID();

    await db.insert(sessions).values([
      {id: expiredId, userId, expiresAt: new Date(Date.now() - 1000)},
      {id: liveId, userId, expiresAt: new Date(Date.now() + 60_000)},
    ]);

    await runCleanup();

    const [expiredRow] = await db.select().from(sessions).where(eq(sessions.id, expiredId));
    assert.equal(expiredRow, undefined, 'expired session was deleted');

    const [liveRow] = await db.select().from(sessions).where(eq(sessions.id, liveId));
    assert.ok(liveRow, 'live session survives');

    await db.delete(users).where(eq(users.id, userId));
  });

  it('removes expired and long-consumed email tokens, keeps live and recently-used ones', async () => {
    const userId = await makeUser('cleanup-tokens');

    const [expired, longUsed, recentlyUsed, live] = await db
      .insert(emailTokens)
      .values([
        {
          userId,
          tokenHash: randomUUID(),
          type: 'verify',
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          userId,
          tokenHash: randomUUID(),
          type: 'reset',
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // used 2h ago
        },
        {
          userId,
          tokenHash: randomUUID(),
          type: 'reset',
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(), // used just now
        },
        {
          userId,
          tokenHash: randomUUID(),
          type: 'change_email',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .returning({id: emailTokens.id});

    await runCleanup();

    const remaining = await db.select({id: emailTokens.id}).from(emailTokens).where(eq(emailTokens.userId, userId));
    const remainingIds = new Set(remaining.map((r) => r.id));

    assert.ok(!remainingIds.has(expired.id), 'expired token was deleted');
    assert.ok(!remainingIds.has(longUsed.id), 'token consumed past the grace period was deleted');
    assert.ok(remainingIds.has(recentlyUsed.id), 'token consumed within the grace period survives');
    assert.ok(remainingIds.has(live.id), 'unconsumed, unexpired token survives');

    await db.delete(users).where(eq(users.id, userId));
  });
});
