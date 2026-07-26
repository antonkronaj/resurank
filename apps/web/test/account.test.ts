import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import type {MatchResult} from '@resurank/scoring';
import {buildApp} from '../src/app.js';
import {closeDatabase, db} from '../src/db/client.js';
import {resumes, scoreHistory, sessions, userSettings, users} from '../src/db/schema.js';
import {
  PASSWORD,
  linkPath,
  login,
  register,
  sessionCookie,
  signedInUser,
  uniqueEmail,
} from './helpers/auth.js';
import {clearMailbox, isMailpitRunning, messagesFor, waitForEmail} from './helpers/mailpit.js';

/**
 * Phase 4: password recovery and account management, against the real Postgres
 * and Mailpit from apps/web/docker-compose.yml. Start them first:
 *   npm --prefix apps/web run db:up
 */

const NEW_PASSWORD = 'a brand new passphrase entirely';

let app: FastifyInstance;
let mailpitUp = false;

async function userRow(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return row;
}

async function sessionCheck(token: string) {
  return app.inject({method: 'GET', url: '/api/auth/session', cookies: {rr_session: token}});
}

/** Runs the forgot-password flow and returns the token from the emailed link. */
async function requestReset(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/forgot-password',
    payload: {email},
  });
  assert.equal(response.statusCode, 200);

  const mail = await waitForEmail(email, {subject: /reset/i});
  const token = new URL(`http://x${linkPath(mail.body)}`).searchParams.get('token');
  assert.ok(token, `no token in reset link: ${mail.body}`);
  return token;
}

/** Seeds one resume and one history row so exports and cascades have content. */
async function seedData(userId: string, filename: string): Promise<void> {
  const [resume] = await db
    .insert(resumes)
    .values({userId, filename, text: 'ten years of typing', terms: ['typing'], isActive: true})
    .returning();

  await db.insert(scoreHistory).values({
    userId,
    resumeId: resume.id,
    resumeFilename: filename,
    jobTitle: 'Staff Engineer',
    jobDescription: 'a job that needs typing',
    score: 73.5,
    // Only the shape matters here; scoring itself is covered by its own suite.
    result: {score: 73.5} as unknown as MatchResult,
  });
}

before(async () => {
  // Raised so these flows are not throttled; throttling has its own test in
  // auth.test.ts with a dedicated app instance.
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

describe('forgot password', () => {
  it('emails a reset link to a real account', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email} = await signedInUser(app, 'forgot');

    await app.inject({method: 'POST', url: '/api/auth/forgot-password', payload: {email}});
    const mail = await waitForEmail(email, {subject: /reset/i});

    assert.match(mail.body, /\/reset-password\?token=/, 'links to the SPA reset screen');
  });

  it('answers identically for an unknown address', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email} = await signedInUser(app, 'forgot-known');
    const ghost = uniqueEmail('forgot-ghost');

    const known = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: {email},
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: {email: ghost},
    });

    assert.equal(known.statusCode, unknown.statusCode);
    assert.deepEqual(known.json(), unknown.json(), 'responses are indistinguishable');
    assert.equal((await messagesFor(ghost)).length, 0, 'nothing is sent to a non-account');
  });
});

describe('reset password', () => {
  it('sets the new password, burns the token, and signs every device out', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token: deviceA} = await signedInUser(app, 'reset-flow');
    const deviceB = sessionCookie((await login(app, email)).headers['set-cookie']);

    const resetToken = await requestReset(email);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: resetToken, password: NEW_PASSWORD},
    });
    assert.equal(response.statusCode, 200);

    assert.equal((await login(app, email, PASSWORD)).statusCode, 401, 'old password is dead');
    assert.equal((await login(app, email, NEW_PASSWORD)).statusCode, 200, 'new password works');

    for (const [label, cookie] of [['A', deviceA], ['B', deviceB]] as const) {
      assert.equal((await sessionCheck(cookie)).statusCode, 401, `device ${label} signed out`);
    }

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: resetToken, password: 'yet another passphrase here'},
    });
    assert.equal(replay.statusCode, 400, 'reset token is single-use');
    assert.equal(replay.json().error, 'invalid_token');
  });

  it('warns the account holder that the password changed', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email} = await signedInUser(app, 'reset-notice');

    const resetToken = await requestReset(email);
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: resetToken, password: NEW_PASSWORD},
    });

    const notice = await waitForEmail(email, {subject: /password was changed/i});
    assert.match(notice.body, /forgot-password/, 'offers a recovery path if it was not them');
  });

  it('recovers an account that was never verified', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const email = uniqueEmail('reset-unverified');
    await register(app, email);
    assert.equal((await login(app, email)).statusCode, 403, 'starts unverified');

    const resetToken = await requestReset(email);
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: resetToken, password: NEW_PASSWORD},
    });

    // Following a link in the inbox proves the same thing verification proves,
    // so the account must not be left stranded.
    const response = await login(app, email, NEW_PASSWORD);
    assert.equal(response.statusCode, 200, 'the reset also verified the address');
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: 'not-a-real-token', password: NEW_PASSWORD},
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'invalid_token');
  });
});

describe('change password', () => {
  const changePassword = (token: string, currentPassword: string, newPassword: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      cookies: {rr_session: token},
      payload: {currentPassword, newPassword},
    });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: {currentPassword: PASSWORD, newPassword: NEW_PASSWORD},
    });
    assert.equal(response.statusCode, 401);
  });

  it('rejects a wrong current password and leaves the old one working', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'change-wrong');

    const response = await changePassword(token, 'not my password', NEW_PASSWORD);

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'invalid_credentials');
    assert.equal((await login(app, email, PASSWORD)).statusCode, 200, 'password is unchanged');
  });

  it('rotates this session and signs other devices out', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token: deviceA} = await signedInUser(app, 'change-ok');
    const deviceB = sessionCookie((await login(app, email)).headers['set-cookie']);

    const response = await changePassword(deviceA, PASSWORD, NEW_PASSWORD);
    assert.equal(response.statusCode, 200);

    const rotated = sessionCookie(response.headers['set-cookie']);
    assert.notEqual(rotated, deviceA, 'the pre-change token is replaced');
    assert.equal((await sessionCheck(rotated)).statusCode, 200, 'this device stays signed in');
    assert.equal((await sessionCheck(deviceA)).statusCode, 401, 'the old token is dead');
    assert.equal((await sessionCheck(deviceB)).statusCode, 401, 'other devices are signed out');

    assert.equal((await login(app, email, NEW_PASSWORD)).statusCode, 200);
    assert.equal((await login(app, email, PASSWORD)).statusCode, 401);
  });
});

describe('profile', () => {
  const patch = (token: string, payload: Record<string, unknown>) =>
    app.inject({method: 'PATCH', url: '/api/users/me', cookies: {rr_session: token}, payload});

  it('returns and updates the display name', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'profile-name');

    const before = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      cookies: {rr_session: token},
    });
    assert.equal(before.statusCode, 200);
    assert.equal(before.json().user.email, email);
    assert.equal(before.json().user.name, null);

    const response = await patch(token, {name: 'Ada Lovelace'});

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.name, 'Ada Lovelace');
    assert.equal(response.json().emailChangePending, false);
    assert.equal((await userRow(email)).name, 'Ada Lovelace');
  });

  it('rejects an update that changes nothing', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'profile-empty');

    const response = await patch(token, {});

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'validation_failed');
  });

  it('holds an email change until the new address confirms it', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'profile-email');
    const nextEmail = uniqueEmail('profile-email-new');

    const response = await patch(token, {email: nextEmail});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().emailChangePending, true);
    assert.equal(response.json().user.email, email, 'the live address has not moved yet');
    assert.equal(response.json().user.pendingEmail, nextEmail);

    // Still signed in under the old address while the change is pending.
    assert.equal((await login(app, email)).statusCode, 200);

    const mail = await waitForEmail(nextEmail, {subject: /confirm/i});
    const confirm = await app.inject({method: 'GET', url: linkPath(mail.body)});
    assert.equal(confirm.statusCode, 302);
    assert.match(confirm.headers.location as string, /email=changed/);

    const row = await userRow(nextEmail);
    assert.ok(row, 'the account now answers to the new address');
    assert.equal(row.pendingEmail, null, 'pending state is cleared');
    assert.equal((await login(app, nextEmail)).statusCode, 200, 'new address signs in');
    assert.equal((await login(app, email)).statusCode, 401, 'old address no longer signs in');

    const notice = await waitForEmail(email, {subject: /email address was changed/i});
    assert.match(notice.body, new RegExp(nextEmail), 'the old inbox is told where it went');
  });

  it('does not reveal that the requested address is already taken', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email: taken} = await signedInUser(app, 'collide-owner');
    const {email, token} = await signedInUser(app, 'collide-mover');
    const free = uniqueEmail('collide-free');

    const onTaken = await patch(token, {email: taken});
    const onFree = await patch(token, {email: free});

    assert.equal(onTaken.statusCode, onFree.statusCode);
    assert.equal(onTaken.json().emailChangePending, onFree.json().emailChangePending);
    assert.equal((await userRow(email)).email, email, 'the live address is untouched');

    // No confirmation link is ever issued for an address the caller does not
    // own — the real owner gets a heads-up instead.
    await waitForEmail(taken, {subject: /already have/i});
    const confirmations = (await messagesFor(taken)).filter((m) => /confirm your new/i.test(m.Subject));
    assert.equal(confirmations.length, 0, 'no confirmation link leaks to the existing owner');
  });

  it('falls back to the unique index when the address is claimed mid-flight', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'race-mover');
    const contested = uniqueEmail('race-contested');

    await patch(token, {email: contested});
    const mail = await waitForEmail(contested, {subject: /confirm/i});

    // Someone registers the address after the link was mailed but before it is
    // clicked. The database index is the last line of defence.
    await register(app, contested);

    const confirm = await app.inject({method: 'GET', url: linkPath(mail.body)});
    assert.equal(confirm.statusCode, 302);
    assert.match(confirm.headers.location as string, /email=taken/);
    assert.equal((await userRow(email)).email, email, 'the mover keeps their address');
  });

  it('cancels a queued email change when the password is reset', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'hijack');
    const attackerEmail = uniqueEmail('hijack-attacker');

    // Someone with a live session queues a move to an address they control.
    await patch(token, {email: attackerEmail});
    const mail = await waitForEmail(attackerEmail, {subject: /confirm/i});

    // The real owner reacts the way anyone would: reset the password.
    const resetToken = await requestReset(email);
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {token: resetToken, password: NEW_PASSWORD},
    });

    // The confirmation link the attacker is holding must now be dead.
    const confirm = await app.inject({method: 'GET', url: linkPath(mail.body)});
    assert.match(confirm.headers.location as string, /email=invalid/);

    const row = await userRow(email);
    assert.equal(row.email, email, 'the address never moved');
    assert.equal(row.pendingEmail, null, 'the queued change was cancelled');
  });

  it('rejects a forged confirmation token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/confirm-email-change?token=not-a-real-token',
    });
    assert.match(response.headers.location as string, /email=invalid/);
  });
});

describe('account deletion', () => {
  const deleteAccount = (token: string, password: string) =>
    app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      cookies: {rr_session: token},
      payload: {password},
    });

  it('refuses a wrong password', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'delete-wrong');

    const response = await deleteAccount(token, 'not my password');

    assert.equal(response.statusCode, 401);
    assert.ok(await userRow(email), 'the account survives');
  });

  it('removes the account and everything attached to it', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'delete-ok');
    const userId = (await userRow(email)).id;
    await seedData(userId, 'goodbye.pdf');

    const response = await deleteAccount(token, PASSWORD);
    assert.equal(response.statusCode, 200);

    assert.equal(await userRow(email), undefined, 'the user row is gone');
    assert.equal((await sessionCheck(token)).statusCode, 401, 'the session is dead');

    for (const [label, rows] of [
      ['sessions', await db.select().from(sessions).where(sql`${sessions.userId} = ${userId}`)],
      ['resumes', await db.select().from(resumes).where(sql`${resumes.userId} = ${userId}`)],
      ['settings', await db.select().from(userSettings).where(sql`${userSettings.userId} = ${userId}`)],
      ['history', await db.select().from(scoreHistory).where(sql`${scoreHistory.userId} = ${userId}`)],
    ] as const) {
      assert.equal(rows.length, 0, `${label} cascaded away`);
    }
  });
});

describe('data export', () => {
  const exportData = (token: string) =>
    app.inject({method: 'GET', url: '/api/users/me/export', cookies: {rr_session: token}});

  it('requires authentication', async () => {
    const response = await app.inject({method: 'GET', url: '/api/users/me/export'});
    assert.equal(response.statusCode, 401);
  });

  it('returns the archive without any secret material', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'export-ok');
    await seedData((await userRow(email)).id, 'my-cv.pdf');

    const response = await exportData(token);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-disposition'] as string, /attachment; filename=/);

    const body = response.json();
    assert.equal(body.user.email, email);
    assert.ok(body.settings, 'settings are included');
    assert.equal(body.resumes.length, 1);
    assert.equal(body.resumes[0].filename, 'my-cv.pdf');
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0].score, 73.5, 'the unrounded score survives the round trip');

    const raw = response.payload;
    assert.doesNotMatch(raw, /passwordHash|password_hash/, 'no password hash field');
    assert.doesNotMatch(raw, /\$argon2/, 'no hash material');
  });

  it("never includes another user's data", async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email: mine, token} = await signedInUser(app, 'export-mine');
    const {email: theirs} = await signedInUser(app, 'export-theirs');
    await seedData((await userRow(mine)).id, 'mine.pdf');
    await seedData((await userRow(theirs)).id, 'theirs.pdf');

    const body = (await exportData(token)).json();

    assert.deepEqual(
      body.resumes.map((resume: {filename: string}) => resume.filename),
      ['mine.pdf'],
    );
    assert.equal(body.history.length, 1, "only the caller's history");
    assert.equal(body.user.email, mine);
  });
});
