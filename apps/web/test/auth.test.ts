import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {closeDatabase, db} from '../src/db/client.js';
import {sessions, userSettings, users} from '../src/db/schema.js';
import {
  PASSWORD,
  login as loginAs,
  register as registerAs,
  registerAndVerify as registerAndVerifyAs,
  sessionCookie,
  uniqueEmail,
} from './helpers/auth.js';
import {clearMailbox, extractLink, isMailpitRunning, waitForEmail} from './helpers/mailpit.js';

/**
 * Integration tests against the real Postgres and Mailpit from
 * apps/web/docker-compose.yml. Start them first:
 *   npm --prefix apps/web run db:up
 */

let app: FastifyInstance;
let mailpitUp = false;

// Thin bindings over the shared helpers so the cases below stay readable;
// `app` is only assigned in before(), so these must resolve it at call time.
const register = (email: string, password?: string) => registerAs(app, email, password);
const registerAndVerify = (email: string) => registerAndVerifyAs(app, email);
const login = (email: string, password?: string) => loginAs(app, email, password);

before(async () => {
  // Raised so the flow tests are not throttled; the real limit gets its own
  // test below with a dedicated app instance.
  app = await buildApp({rateLimitMax: 10_000});
  await app.ready();
  mailpitUp = await isMailpitRunning();
  if (mailpitUp) await clearMailbox();
});

after(async () => {
  // Every table cascades from users, so this clears all test data.
  await db.delete(users).where(sql`${users.email} like '%@example.test'`);
  await app.close();
  await closeDatabase();
});

describe('registration', () => {
  it('creates an unverified user with default settings', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('new');

    await register(email);

    const [user] = await db.select().from(users).where(sql`${users.email} = ${email}`);
    assert.ok(user, 'user row was created');
    assert.equal(user.emailVerified, false, 'starts unverified');
    assert.notEqual(user.passwordHash, PASSWORD, 'password is not stored in plaintext');
    assert.match(user.passwordHash, /^\$argon2id\$/, 'password is argon2id hashed');

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(sql`${userSettings.userId} = ${user.id}`);
    assert.ok(settings, 'settings row created alongside the user');
    assert.equal(settings.missingKeywordSettings.maxPenalty, 0.25, 'desktop default penalty');
    assert.deepEqual(settings.stopwords, []);
  });

  it('sends a verification email', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('verify-mail');

    await register(email);
    const mail = await waitForEmail(email);

    assert.match(mail.subject, /verify/i);
    assert.match(extractLink(mail.body), /\/api\/auth\/verify-email\?token=/);
  });

  it('does not reveal whether an email is already registered', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('dupe');

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {email, password: PASSWORD},
    });
    await waitForEmail(email);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {email, password: 'a completely different password'},
    });

    assert.equal(first.statusCode, second.statusCode, 'same status for new and existing email');
    assert.deepEqual(first.json(), second.json(), 'byte-identical response body');

    // The real account holder is warned by email instead.
    const notice = await waitForEmail(email, {subject: /already have/i});
    assert.match(notice.body, /forgot-password/, 'offers a password reset');

    // And the existing password must be untouched.
    const bad = await login(email, 'a completely different password');
    assert.equal(bad.statusCode, 401, 'second registration did not overwrite the password');
  });

  it('rejects a weak password and a malformed email', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {email: uniqueEmail('weak'), password: 'short'},
    });
    assert.equal(short.statusCode, 400);
    assert.equal(short.json().error, 'validation_failed');

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {email: 'not-an-email', password: PASSWORD},
    });
    assert.equal(malformed.statusCode, 400);
  });
});

describe('email verification', () => {
  it('verifies the account and refuses to reuse the token', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('single-use');

    await register(email);
    const mail = await waitForEmail(email);
    const link = new URL(extractLink(mail.body));
    const path = link.pathname + link.search;

    const first = await app.inject({method: 'GET', url: path});
    assert.equal(first.statusCode, 302);
    assert.match(first.headers.location as string, /status=success/);

    const [user] = await db.select().from(users).where(sql`${users.email} = ${email}`);
    assert.equal(user.emailVerified, true);

    const replay = await app.inject({method: 'GET', url: path});
    assert.match(replay.headers.location as string, /status=invalid/, 'token is single-use');
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/verify-email?token=not-a-real-token',
    });
    assert.match(response.headers.location as string, /status=invalid/);
  });
});

describe('login', () => {
  it('refuses an unverified account', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('unverified');

    await register(email);
    const response = await login(email);

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'email_not_verified');
  });

  it('issues a session cookie for valid credentials', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('login-ok');

    await registerAndVerify(email);
    const response = await login(email);

    assert.equal(response.statusCode, 200);
    const cookie = response.cookies.find((c) => c.name === 'rr_session');
    assert.ok(cookie, 'session cookie set');
    assert.equal(cookie.httpOnly, true, 'cookie is httpOnly');
    assert.equal(cookie.sameSite?.toLowerCase(), 'lax');
    assert.equal(response.json().user.email, email);
    assert.equal(response.json().user.passwordHash, undefined, 'never leaks the hash');
  });

  it('stores a hash of the session token, not the token itself', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('token-hash');

    await registerAndVerify(email);
    const response = await login(email);
    const token = sessionCookie(response.headers['set-cookie']);

    const rows = await db.select().from(sessions);
    assert.ok(rows.length > 0);
    assert.ok(
      rows.every((row) => row.id !== token),
      'raw session token must never appear in the database',
    );
  });

  it('returns the same error for a wrong password and an unknown email', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('enumerate');
    await registerAndVerify(email);

    const wrongPassword = await login(email, 'definitely not the password');
    const unknownEmail = await login(uniqueEmail('ghost'), PASSWORD);

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(unknownEmail.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), unknownEmail.json(), 'responses are indistinguishable');
  });
});

describe('sessions', () => {
  it('rejects unauthenticated access to a protected route', async () => {
    const response = await app.inject({method: 'GET', url: '/api/auth/session'});
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'unauthenticated');
  });

  it('rejects a forged session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: {rr_session: 'forged-token-value'},
    });
    assert.equal(response.statusCode, 401);
  });

  it('resolves the signed-in user', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('session-me');

    await registerAndVerify(email);
    const token = sessionCookie((await login(email)).headers['set-cookie']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: {rr_session: token},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.email, email);
  });

  it('invalidates the session on logout', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('logout');

    await registerAndVerify(email);
    const token = sessionCookie((await login(email)).headers['set-cookie']);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: {rr_session: token},
    });
    assert.equal(logout.statusCode, 200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: {rr_session: token},
    });
    assert.equal(after.statusCode, 401, 'the old cookie is dead server-side');
  });

  it('logout-all revokes every device', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('logout-all');

    await registerAndVerify(email);
    const deviceA = sessionCookie((await login(email)).headers['set-cookie']);
    const deviceB = sessionCookie((await login(email)).headers['set-cookie']);
    assert.notEqual(deviceA, deviceB, 'two distinct sessions');

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout-all',
      cookies: {rr_session: deviceA},
    });

    for (const [label, token] of [['A', deviceA], ['B', deviceB]] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        cookies: {rr_session: token},
      });
      assert.equal(response.statusCode, 401, `device ${label} was signed out`);
    }
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts from one client', async () => {
    const throttled = await buildApp({rateLimitMax: 3});
    await throttled.ready();

    try {
      const attempt = () =>
        throttled.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: {email: uniqueEmail('bruteforce'), password: 'wrong password'},
        });

      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await attempt()).statusCode);
      }

      assert.equal(statuses.filter((s) => s === 429).length, 2, 'blocks after the 3rd attempt');
      assert.deepEqual(statuses.slice(0, 3), [401, 401, 401], 'first three are processed');
    } finally {
      await throttled.close();
    }
  });

  it('throttles unauthenticated requests to routes with no route-specific limit', async () => {
    // GET /api/health has no `writeLimit()`/auth-route config of its own — it
    // only gets a ceiling at all via the global baseline (`app.ts`'s
    // `register(rateLimit, {global: true, ...})`). Public and unauthenticated,
    // so this is the endpoint an attacker (or a buggy client) can hit hardest.
    const throttled = await buildApp({rateLimitMax: 3});
    await throttled.ready();

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await throttled.inject({method: 'GET', url: '/api/health'})).statusCode);
      }

      assert.equal(statuses.filter((s) => s === 429).length, 2, 'blocks after the 3rd request');
      assert.deepEqual(statuses.slice(0, 3), [200, 200, 200], 'first three are processed');
    } finally {
      await throttled.close();
    }
  });
});

describe('user isolation', () => {
  it("one user's session never resolves to another user", async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const alice = uniqueEmail('alice');
    const bob = uniqueEmail('bob');

    await registerAndVerify(alice);
    await registerAndVerify(bob);

    const aliceToken = sessionCookie((await login(alice)).headers['set-cookie']);
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: {rr_session: aliceToken},
    });

    assert.equal(response.json().user.email, alice);
    assert.notEqual(response.json().user.email, bob);
  });
});
