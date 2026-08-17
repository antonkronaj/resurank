import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, describe, it} from 'node:test';
import {and, eq, inArray, isNull, notInArray, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {config} from '../src/config.js';
import {closeDatabase, db} from '../src/db/client.js';
import {adminAuditLog, resumes, scoreHistory, sessions, userSettings, users} from '../src/db/schema.js';
import {seedAdminUser} from '../src/lib/admin-seed.js';
import {PASSWORD, login as loginAs, registerAndVerify as registerAndVerifyAs, sessionCookie, uniqueEmail} from './helpers/auth.js';
import {clearMailbox, isMailpitRunning} from './helpers/mailpit.js';

/**
 * Integration tests against the real Postgres from apps/web/docker-compose.yml.
 * Start it first: npm --prefix apps/web run db:up
 */

let app: FastifyInstance;
let mailpitUp = false;

const registerAndVerify = (email: string) => registerAndVerifyAs(app, email);
const login = (email: string, password?: string) => loginAs(app, email, password);

/** Registers, verifies, signs in, then promotes the row to admin directly —
 * the seeder itself only runs from src/index.ts, not buildApp(), so tests
 * that need an admin session promote one the same way an existing admin's
 * PATCH .../role would. */
async function signedInAdmin(label: string): Promise<{id: string; email: string; token: string}> {
  const email = uniqueEmail(label);
  await registerAndVerify(email);
  const loginResponse = await login(email);
  assert.equal(loginResponse.statusCode, 200);
  const token = sessionCookie(loginResponse.headers['set-cookie']);

  const [user] = await db
    .update(users)
    .set({role: 'admin'})
    .where(sql`${users.email} = ${email}`)
    .returning();
  assert.ok(user, 'promoted user exists');

  return {id: user.id, email, token};
}

async function signedInUser(label: string): Promise<{id: string; email: string; token: string}> {
  const email = uniqueEmail(label);
  await registerAndVerify(email);
  const loginResponse = await login(email);
  assert.equal(loginResponse.statusCode, 200);
  const token = sessionCookie(loginResponse.headers['set-cookie']);
  const [user] = await db.select().from(users).where(sql`${users.email} = ${email}`);
  return {id: user.id, email, token};
}

function authHeader(token: string): {cookie: string} {
  return {cookie: `rr_session=${token}`};
}

before(async () => {
  app = await buildApp({rateLimitMax: 10_000});
  await app.ready();
  mailpitUp = await isMailpitRunning();
  if (mailpitUp) await clearMailbox();
});

after(async () => {
  // Every table cascades from users; admin_audit_log.actor_id is `set null`
  // rather than cascading, so its rows for these test admins are cleaned up
  // explicitly (they'd otherwise linger forever with a null actor).
  // Matches on either side: seed_admin rows are written with actorEmail
  // 'system', so a row for a test-seeded admin is only findable by
  // targetEmail — while a deleted target's row (delete_user) is only
  // findable by actorEmail, since targetEmail there names an account that
  // no longer exists to filter by anything else.
  await db
    .delete(adminAuditLog)
    .where(
      sql`${adminAuditLog.actorEmail} like '%@example.test' or ${adminAuditLog.targetEmail} like '%@example.test'`,
    );
  await db.delete(users).where(sql`${users.email} like '%@example.test'`);
  await app.close();
  await closeDatabase();
});

describe('authorization', () => {
  it('rejects every /api/admin/* route for a non-admin user', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const user = await signedInUser('non-admin');

    const routes: Array<{method: 'GET' | 'PATCH' | 'POST' | 'DELETE'; url: string}> = [
      {method: 'GET', url: '/api/admin/stats'},
      {method: 'GET', url: '/api/admin/users'},
      {method: 'GET', url: `/api/admin/users/${user.id}`},
      {method: 'GET', url: `/api/admin/users/${user.id}/export`},
      {method: 'PATCH', url: `/api/admin/users/${user.id}/role`},
      {method: 'PATCH', url: `/api/admin/users/${user.id}/status`},
      {method: 'POST', url: `/api/admin/users/${user.id}/verify-email`},
      {method: 'POST', url: `/api/admin/users/${user.id}/revoke-sessions`},
      {method: 'DELETE', url: `/api/admin/users/${user.id}`},
      {method: 'GET', url: '/api/admin/audit'},
    ];

    for (const route of routes) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: authHeader(user.token),
        payload: {},
      });
      assert.equal(response.statusCode, 403, `${route.method} ${route.url} should be 403`);
      assert.equal(response.json().error, 'forbidden');
    }
  });

  it('rejects an unauthenticated caller with 401, not 403', async () => {
    const response = await app.inject({method: 'GET', url: '/api/admin/users'});
    assert.equal(response.statusCode, 401);
  });
});

describe('boot seeder', () => {
  it('creates the admin on an empty slot, and promotes+re-hashes an existing user on rerun', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('seed-target');
    const noopLog = {info: () => {}};

    // config.ts reads ADMIN_EMAIL/ADMIN_PASSWORD from the environment once at
    // import time, and the module is already cached by the time this test
    // runs (imported transitively via src/app.js above), so setting
    // process.env here would have no effect. Mutate the cached singleton's
    // `admin` field directly instead — seedAdminUser reads `config.admin` on
    // every call, so this is equivalent to restarting with different env.
    const originalAdmin = config.admin;
    // @ts-expect-error -- test-only mutation of the readonly config singleton.
    config.admin = {email, password: 'first-seed-password'};

    try {
      await seedAdminUser(noopLog);
      const [created] = await db.select().from(users).where(sql`${users.email} = ${email}`);
      assert.ok(created, 'admin row created');
      assert.equal(created.role, 'admin');
      assert.equal(created.emailVerified, true);
      const firstHash = created.passwordHash;

      // Second run with a different password promotes+re-hashes the same row.
      // @ts-expect-error -- test-only mutation of the frozen config singleton.
      config.admin = {email, password: 'second-seed-password'};
      await seedAdminUser(noopLog);
      const [rerun] = await db.select().from(users).where(sql`${users.email} = ${email}`);
      assert.equal(rerun.id, created.id, 'same row, not a duplicate');
      assert.equal(rerun.role, 'admin');
      assert.notEqual(rerun.passwordHash, firstHash, 'password hash was rewritten');
    } finally {
      // @ts-expect-error -- test-only restore.
      config.admin = originalAdmin;
    }
  });
});

describe('user search and listing', () => {
  it('matches by email prefix and name substring, respects status filter, and paginates', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('search-admin');
    const target = await signedInUser('zsearchable');
    await db.update(users).set({name: 'Findable Person'}).where(eq(users.id, target.id));

    const byEmail = await app.inject({
      method: 'GET',
      url: `/api/admin/users?q=${encodeURIComponent(target.email.split('@')[0])}`,
      headers: authHeader(admin.token),
    });
    assert.equal(byEmail.statusCode, 200);
    assert.ok(
      byEmail.json().users.some((u: {id: string}) => u.id === target.id),
      'found by email prefix',
    );

    const byName = await app.inject({
      method: 'GET',
      url: '/api/admin/users?q=Findable',
      headers: authHeader(admin.token),
    });
    assert.ok(
      byName.json().users.some((u: {id: string}) => u.id === target.id),
      'found by name substring',
    );

    const suspendedOnly = await app.inject({
      method: 'GET',
      url: '/api/admin/users?status=suspended',
      headers: authHeader(admin.token),
    });
    assert.equal(suspendedOnly.statusCode, 200);
    assert.ok(
      !suspendedOnly.json().users.some((u: {id: string}) => u.id === target.id),
      'active user excluded by status=suspended',
    );

    const page = await app.inject({
      method: 'GET',
      url: '/api/admin/users?limit=1&offset=0',
      headers: authHeader(admin.token),
    });
    const body = page.json();
    assert.equal(body.users.length, 1);
    assert.ok(body.total >= 2, 'total reflects the full match count, not just this page');
  });
});

describe('user-detail session list', () => {
  it('excludes expired sessions', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('session-list-admin');
    const target = await signedInUser('session-list-target');

    const expiredId = randomUUID();
    await db.insert(sessions).values({
      id: expiredId,
      userId: target.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${target.id}`,
      headers: authHeader(admin.token),
    });
    assert.equal(response.statusCode, 200);
    const returnedIds = response.json().sessions.map((s: {id: string}) => s.id);
    assert.ok(!returnedIds.includes(expiredId), 'expired session omitted from the list');

    await db.delete(sessions).where(eq(sessions.id, expiredId));
  });
});

describe('delete cascade', () => {
  it('removes the user and all owned rows', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('delete-admin');
    const target = await signedInUser('delete-target');

    await app.inject({
      method: 'POST',
      url: '/api/resumes',
      headers: authHeader(target.token),
      payload: {filename: 'r.txt', text: 'hello world', terms: ['hello']},
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.id}`,
      headers: authHeader(admin.token),
      payload: {password: PASSWORD},
    });
    assert.equal(response.statusCode, 200);

    const [gone] = await db.select().from(users).where(eq(users.id, target.id));
    assert.equal(gone, undefined);
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, target.id));
    assert.equal(settings, undefined);
    const remainingResumes = await db.select().from(resumes).where(eq(resumes.userId, target.id));
    assert.equal(remainingResumes.length, 0);
    const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    assert.equal(remainingSessions.length, 0);
  });
});

describe('guardrails', () => {
  it('rejects a wrong password with 401', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('badpw-admin');
    const target = await signedInUser('badpw-target');

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.id}`,
      headers: authHeader(admin.token),
      payload: {password: 'definitely-wrong'},
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'invalid_credentials');

    const [stillThere] = await db.select().from(users).where(eq(users.id, target.id));
    assert.ok(stillThere, 'target was not deleted');
  });

  it('rejects self-targeting with 409', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('self-admin');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${admin.id}/status`,
      headers: authHeader(admin.token),
      payload: {disabled: true, password: PASSWORD},
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'conflict');
  });

  it('demoting to a single admin succeeds — the guard only blocks reaching zero', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('demote-a');
    const other = await signedInAdmin('demote-b');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${other.id}/role`,
      headers: authHeader(admin.token),
      payload: {role: 'user', password: PASSWORD},
    });
    assert.equal(response.statusCode, 200, 'one admin demoting another, leaving one, is fine');
  });

  it('never lets concurrent demotions leave zero active admins', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    // With self-targeting blocked, a lone actor can never sequentially drive
    // the active-admin count to zero — they always remain in the "remaining"
    // set alongside the target. The guard exists for the race where two
    // admins demote *each other* at the same time: each call, read in
    // isolation, sees the other as the survivor. lib/admin-guards.ts's
    // `checkAdminQuorum` takes `FOR UPDATE` on every active-admin row so the
    // second transaction re-reads a count that already reflects the first's
    // commit, rather than the stale snapshot it started with.
    const a = await signedInAdmin('race-a');
    const b = await signedInAdmin('race-b');

    // Every earlier test in this file left its own admins active — the file
    // shares one `after()` cleanup rather than resetting between `it()`s —
    // so without narrowing the pool, `a` and `b` are never actually the only
    // two active admins and the guard has no reason to fire. This directly
    // suspends every other active admin (bypassing the API, since this is
    // test isolation, not behavior under test) so the race is deterministic.
    await db
      .update(users)
      .set({disabledAt: new Date()})
      .where(
        and(eq(users.role, 'admin'), isNull(users.disabledAt), notInArray(users.id, [a.id, b.id])),
      );

    const [resultA, resultB] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${b.id}/role`,
        headers: authHeader(a.token),
        payload: {role: 'user', password: PASSWORD},
      }),
      app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${a.id}/role`,
        headers: authHeader(b.token),
        payload: {role: 'user', password: PASSWORD},
      }),
    ]);

    assert.deepEqual(
      [resultA.statusCode, resultB.statusCode].sort(),
      [200, 409],
      'exactly one demotion wins and the other is rejected as the last admin',
    );

    const rows = await db
      .select({role: users.role, disabledAt: users.disabledAt})
      .from(users)
      .where(inArray(users.id, [a.id, b.id]));
    const activeAdmins = rows.filter((row) => row.role === 'admin' && row.disabledAt === null);
    assert.equal(activeAdmins.length, 1, 'exactly one of the two remains an active admin');
  });
});

describe('suspend', () => {
  it('revokes sessions on suspend, and blocks a fresh login with account_disabled', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('suspend-admin');
    const target = await signedInUser('suspend-target');

    const suspend = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}/status`,
      headers: authHeader(admin.token),
      payload: {disabled: true, password: PASSWORD},
    });
    assert.equal(suspend.statusCode, 200);

    const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
    assert.equal(remainingSessions.length, 0, 'sessions revoked on suspend');

    // The old session is gone outright (revoked, not merely flagged), so the
    // next request with it reads as an ordinary expired session, not as
    // account_disabled — that code path exists for the session requireAuth
    // resolves *without* first checking suspension state, i.e. a fresh login.
    const whoAmI = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: authHeader(target.token),
    });
    assert.equal(whoAmI.statusCode, 401);
    assert.equal(whoAmI.json().error, 'unauthenticated');

    // A suspended account must not be able to mint a *new* session either.
    const retryLogin = await login(target.email);
    assert.equal(retryLogin.statusCode, 403);
    assert.equal(retryLogin.json().error, 'account_disabled');
  });
});

describe('grant and revoke admin', () => {
  it('lets a promoted user reach admin routes, and blocks it again after revoke', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('grant-admin');
    const target = await signedInUser('grant-target');

    const grant = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}/role`,
      headers: authHeader(admin.token),
      payload: {role: 'admin', password: PASSWORD},
    });
    assert.equal(grant.statusCode, 200);

    const canList = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: authHeader(target.token),
    });
    assert.equal(canList.statusCode, 200);

    const revoke = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}/role`,
      headers: authHeader(admin.token),
      payload: {role: 'user', password: PASSWORD},
    });
    assert.equal(revoke.statusCode, 200);

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: authHeader(target.token),
    });
    assert.equal(blocked.statusCode, 403);
  });
});

describe('audit log', () => {
  it('writes exactly one row per destructive action, surviving the actor being deleted', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('audit-admin');
    const target = await signedInUser('audit-target');

    const before = await db.select({total: sql<number>`count(*)`}).from(adminAuditLog);

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.id}/verify-email`,
      headers: authHeader(admin.token),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.id}/revoke-sessions`,
      headers: authHeader(admin.token),
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}/status`,
      headers: authHeader(admin.token),
      payload: {disabled: true, password: PASSWORD},
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.id}`,
      headers: authHeader(admin.token),
      payload: {password: PASSWORD},
    });

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetEmail, target.email))
      .orderBy(adminAuditLog.createdAt);
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.action),
      ['force_verify', 'revoke_sessions', 'suspend_user', 'delete_user'],
    );
    for (const row of rows) assert.equal(row.actorEmail, admin.email);

    // Deleting the actor must not delete their audit trail — actorId nulls
    // out (ON DELETE SET NULL) but actorEmail is the durable record.
    await db.delete(users).where(eq(users.id, admin.id));
    const [survivor] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetEmail, target.email))
      .limit(1);
    assert.ok(survivor, 'audit row survives actor deletion');
    assert.equal(survivor.actorId, null);
    assert.equal(survivor.actorEmail, admin.email);

    const after_ = await db.select({total: sql<number>`count(*)`}).from(adminAuditLog);
    assert.equal(Number(after_[0].total) - Number(before[0].total), 4);
  });

  it('filters by targetId, powering the trail on the user detail page', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const admin = await signedInAdmin('audit-filter-admin');
    const targetA = await signedInUser('audit-filter-a');
    const targetB = await signedInUser('audit-filter-b');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${targetA.id}/verify-email`,
      headers: authHeader(admin.token),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${targetB.id}/verify-email`,
      headers: authHeader(admin.token),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${targetA.id}/revoke-sessions`,
      headers: authHeader(admin.token),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/audit?targetId=${targetA.id}`,
      headers: authHeader(admin.token),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.total, 2, 'only targetA rows counted');
    assert.ok(
      body.entries.every((e: {targetId: string}) => e.targetId === targetA.id),
      'no targetB rows leaked into the filtered result',
    );
  });
});
