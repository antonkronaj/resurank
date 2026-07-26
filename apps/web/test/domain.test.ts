import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {and, eq, sql} from 'drizzle-orm';
import type {FastifyInstance, LightMyRequestResponse} from 'fastify';
import {JOB_DESCRIPTION_CHAR_CAP, RESUME_CHAR_CAP} from '@resurank/scoring';
import {buildApp} from '../src/app.js';
import {closeDatabase, db} from '../src/db/client.js';
import {resumes, users} from '../src/db/schema.js';
import {signedInUser} from './helpers/auth.js';
import {clearMailbox, isMailpitRunning} from './helpers/mailpit.js';

/**
 * Phase 5: resumes, settings, history and bootstrap. Integration tests against
 * the real Postgres from apps/web/docker-compose.yml:
 *   npm --prefix apps/web run db:up
 */

const RESULT = {
  score: 73.5,
  matchedTerms: ['typing'],
  missingTerms: [],
  breakdown: {embedding: 0.71, tfidf: 0.78},
};

let app: FastifyInstance;
let mailpitUp = false;

type Res = Promise<LightMyRequestResponse>;

const get = (token: string, url: string): Res =>
  app.inject({method: 'GET', url, cookies: {rr_session: token}});
const del = (token: string, url: string): Res =>
  app.inject({method: 'DELETE', url, cookies: {rr_session: token}});
const post = (token: string, url: string, payload: Record<string, unknown>): Res =>
  app.inject({method: 'POST', url, cookies: {rr_session: token}, payload});
const patch = (token: string, url: string, payload: Record<string, unknown>): Res =>
  app.inject({method: 'PATCH', url, cookies: {rr_session: token}, payload});
const put = (token: string, url: string): Res =>
  app.inject({method: 'PUT', url, cookies: {rr_session: token}});

async function upload(
  token: string,
  filename: string,
  text = 'ten years of typing things',
  terms = ['typing', 'things'],
): Promise<string> {
  const response = await post(token, '/api/resumes', {filename, text, terms});
  assert.equal(response.statusCode, 201, `upload failed: ${response.payload}`);
  return response.json().resume.id;
}

async function saveScore(token: string, resumeId: string | null, jobTitle: string): Res {
  return post(token, '/api/history', {
    resumeId,
    jobTitle,
    jobDescription: 'a job that needs typing',
    result: RESULT,
  });
}

/** Counts rows the database considers active — the invariant under test. */
async function activeCount(userId: string): Promise<number> {
  const rows = await db
    .select({id: resumes.id})
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)));
  return rows.length;
}

async function userId(email: string): Promise<string> {
  const [row] = await db
    .select({id: users.id})
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return row.id;
}

before(async () => {
  app = await buildApp({rateLimitMax: 10_000});
  await app.ready();
  mailpitUp = await isMailpitRunning();
  if (mailpitUp) await clearMailbox();
});

after(async () => {
  await db.delete(users).where(sql`${users.email} like '%@example.test'`);
  await app.close();
  await closeDatabase();
});

describe('resumes', () => {
  it('rejects unauthenticated access', async () => {
    assert.equal((await app.inject({method: 'GET', url: '/api/resumes'})).statusCode, 401);
  });

  it('stores extracted text and lists it without shipping the text back', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'resume-list');
    await upload(token, 'cv.pdf', 'a resume about typing', ['typing']);

    const response = await get(token, '/api/resumes');
    assert.equal(response.statusCode, 200);

    const [summary] = response.json().resumes;
    assert.equal(summary.filename, 'cv.pdf');
    assert.equal(summary.isActive, true, 'the first upload is active');
    assert.equal(summary.chars, 'a resume about typing'.length, 'length computed in SQL');
    assert.equal(summary.termCount, 1);
    assert.equal(summary.text, undefined, 'the list never carries resume text');
  });

  it('returns the full text from the detail endpoint', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'resume-detail');
    const id = await upload(token, 'cv.pdf', 'the whole document', ['whole']);

    const response = await get(token, `/api/resumes/${id}`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().resume.text, 'the whole document');
    assert.deepEqual(response.json().resume.terms, ['whole']);
  });

  it('hands active status to each new upload', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-active');
    const first = await upload(token, 'old.pdf');
    const second = await upload(token, 'new.pdf');

    const byId = new Map<string, boolean>(
      (await get(token, '/api/resumes')).json().resumes.map((r: {id: string; isActive: boolean}) => [
        r.id,
        r.isActive,
      ]),
    );

    assert.equal(byId.get(second), true, 'the newest upload is active');
    assert.equal(byId.get(first), false, 'the previous one stepped down');
    assert.equal(await activeCount(await userId(email)), 1, 'never two active at once');
  });

  it('switches the active resume on demand', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-switch');
    const first = await upload(token, 'old.pdf');
    await upload(token, 'new.pdf');

    const response = await put(token, `/api/resumes/${first}/active`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().activeResumeId, first);
    assert.equal((await get(token, `/api/resumes/${first}`)).json().resume.isActive, true);
    assert.equal(await activeCount(await userId(email)), 1);
  });

  it('promotes the next resume when the active one is deleted', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-promote');
    const older = await upload(token, 'older.pdf');
    const active = await upload(token, 'active.pdf');

    const response = await del(token, `/api/resumes/${active}`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().activeResumeId, older, 'the account is never left with none');
    assert.equal((await get(token, `/api/resumes/${older}`)).json().resume.isActive, true);
    assert.equal(await activeCount(await userId(email)), 1);
  });

  it('leaves nothing active when the last resume goes', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-last');
    const only = await upload(token, 'only.pdf');

    const response = await del(token, `/api/resumes/${only}`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().activeResumeId, null);
    assert.equal(await activeCount(await userId(email)), 0);
  });

  it('refuses text over the scoring cap', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'resume-cap');

    const response = await post(token, '/api/resumes', {
      filename: 'huge.pdf',
      text: 'a'.repeat(RESUME_CHAR_CAP + 1),
      terms: ['a'],
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_large');
    assert.match(response.json().message, /32,000/, 'the message names the limit');
  });

  it('accepts text exactly at the cap', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'resume-cap-edge');

    const response = await post(token, '/api/resumes', {
      filename: 'exact.pdf',
      text: 'a'.repeat(RESUME_CHAR_CAP),
      terms: ['a'],
    });

    assert.equal(response.statusCode, 201, 'the cap is inclusive');
  });

  it('survives two uploads racing each other', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-race');

    // A double-clicked upload button, on an account with nothing to clear yet.
    // Each transaction clears the active flag and inserts an active row; with
    // no row to lock, they would all race the partial unique index and all but
    // one would 500.
    const responses = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        post(token, '/api/resumes', {filename: `${name}.pdf`, text: name, terms: [name]}),
      ),
    );

    for (const [index, response] of responses.entries()) {
      assert.equal(response.statusCode, 201, `upload ${index}: ${response.payload}`);
    }
    assert.equal(await activeCount(await userId(email)), 1, 'exactly one ends up active');
  });

  it('rejects a malformed id', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'resume-badid');

    const response = await get(token, '/api/resumes/not-a-uuid');

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'validation_failed');
  });
});

describe('settings', () => {
  it('starts from the desktop defaults', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-default');

    const {settings} = (await get(token, '/api/settings')).json();

    assert.deepEqual(settings.stopwords, []);
    assert.deepEqual(settings.termBoosts, {});
    assert.equal(settings.missingKeywordSettings.enabled, false);
    assert.equal(settings.missingKeywordSettings.maxPenalty, 0.25);
    assert.equal(settings.preferenceMismatchSettings.text, '');
  });

  it('updates one key without disturbing the others', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-partial');

    await patch(token, '/api/settings', {stopwords: ['the', 'and']});
    await patch(token, '/api/settings', {termBoosts: {rust: 2}});

    const {settings} = (await get(token, '/api/settings')).json();
    assert.deepEqual(settings.stopwords, ['the', 'and'], 'the earlier write survived');
    assert.deepEqual(settings.termBoosts, {rust: 2});
    assert.equal(settings.missingKeywordSettings.maxPenalty, 0.25, 'untouched keys keep defaults');
  });

  it('stores the nested settings objects verbatim', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-nested');
    const missingKeywordSettings = {
      enabled: true,
      maxPenalty: 0.4,
      pinnedTerms: [{term: 'rust', importance: 'high'}],
    };

    const response = await patch(token, '/api/settings', {missingKeywordSettings});

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().settings.missingKeywordSettings, missingKeywordSettings);
  });

  it('rejects an out-of-range penalty and an empty patch', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-invalid');

    const outOfRange = await patch(token, '/api/settings', {
      preferenceMismatchSettings: {enabled: true, maxPenalty: 5, text: 'remote only'},
    });
    const empty = await patch(token, '/api/settings', {});

    assert.equal(outOfRange.statusCode, 400);
    assert.equal(empty.statusCode, 400);
  });
});

describe('history', () => {
  it('derives the score and filename from trusted sources', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-create');
    const resumeId = await upload(token, 'cv.pdf');

    const response = await saveScore(token, resumeId, 'Staff Engineer');

    assert.equal(response.statusCode, 201);
    const {entry} = response.json();
    assert.equal(entry.score, 73.5, 'score comes from result.score, not a separate field');
    assert.equal(entry.resumeFilename, 'cv.pdf', 'filename denormalised from the resume');
    assert.equal(entry.jobTitle, 'Staff Engineer');
  });

  it('keeps the unrounded float intact', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-float');
    const resumeId = await upload(token, 'cv.pdf');

    await post(token, '/api/history', {
      resumeId,
      jobTitle: 'Precision',
      jobDescription: 'a job',
      result: {...RESULT, score: 61.23456789},
    });

    const [entry] = (await get(token, '/api/history')).json().history;
    assert.equal(entry.score, 61.23456789, 'double precision, not truncated to an int');
  });

  it('lists summaries and serves the full entry separately', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-list');
    const resumeId = await upload(token, 'cv.pdf');
    await saveScore(token, resumeId, 'First');
    await saveScore(token, resumeId, 'Second');

    const list = (await get(token, '/api/history')).json();
    assert.equal(list.history.length, 2);
    assert.equal(list.history[0].jobDescription, undefined, 'no job description in the list');
    assert.equal(list.history[0].result, undefined, 'no MatchResult in the list');

    const {entry} = (await get(token, `/api/history/${list.history[0].id}`)).json();
    assert.equal(entry.jobDescription, 'a job that needs typing');
    assert.deepEqual(entry.result, RESULT, 'the stored MatchResult round-trips');
  });

  it('filters by resume and paginates', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-filter');
    const a = await upload(token, 'a.pdf');
    const b = await upload(token, 'b.pdf');
    await saveScore(token, a, 'For A');
    await saveScore(token, b, 'For B one');
    await saveScore(token, b, 'For B two');

    const forB = (await get(token, `/api/history?resumeId=${b}`)).json();
    assert.equal(forB.history.length, 2);
    assert.ok(
      forB.history.every((e: {resumeId: string}) => e.resumeId === b),
      'only entries for the requested resume',
    );

    const paged = (await get(token, '/api/history?limit=1&offset=1')).json();
    assert.equal(paged.history.length, 1);
    assert.equal(paged.limit, 1);
    assert.equal(paged.offset, 1);
  });

  it('refuses a job description over the scoring cap', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-cap');

    const response = await post(token, '/api/history', {
      jobTitle: 'Verbose',
      jobDescription: 'a'.repeat(JOB_DESCRIPTION_CHAR_CAP + 1),
      result: RESULT,
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_large');
  });

  it('survives the resume it scored being deleted', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-orphan');
    const resumeId = await upload(token, 'doomed.pdf');
    await saveScore(token, resumeId, 'Scored');

    await del(token, `/api/resumes/${resumeId}`);

    const [entry] = (await get(token, '/api/history')).json().history;
    assert.ok(entry, 'the history entry outlives the resume');
    assert.equal(entry.resumeId, null, 'the link is nulled');
    assert.equal(entry.resumeFilename, 'doomed.pdf', 'but the name it was scored against remains');
  });

  it('deletes an entry', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-delete');
    const resumeId = await upload(token, 'cv.pdf');
    const id = (await saveScore(token, resumeId, 'Temporary')).json().entry.id;

    assert.equal((await del(token, `/api/history/${id}`)).statusCode, 200);
    assert.equal((await get(token, '/api/history')).json().history.length, 0);
    assert.equal((await del(token, `/api/history/${id}`)).statusCode, 404, 'gone stays gone');
  });
});

describe('bootstrap', () => {
  it('rejects unauthenticated access', async () => {
    assert.equal((await app.inject({method: 'GET', url: '/api/bootstrap'})).statusCode, 401);
  });

  it('returns a StoreSnapshot-shaped payload in one round trip', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'bootstrap-full');
    await upload(token, 'old.pdf');
    await upload(token, 'active.pdf', 'the active resume text', ['active']);
    await patch(token, '/api/settings', {stopwords: ['the']});

    const body = (await get(token, '/api/bootstrap')).json();

    // The five keys StorageService.load() feeds to its getters.
    assert.equal(body.resume.filename, 'active.pdf', 'resume is the active one');
    assert.equal(body.resume.text, 'the active resume text', 'with full text, for scoring');
    assert.deepEqual(body.stopwords, ['the']);
    assert.deepEqual(body.termBoosts, {});
    assert.equal(body.missingKeywordSettings.maxPenalty, 0.25);
    assert.equal(body.preferenceMismatchSettings.text, '');

    // Web-only additions alongside them.
    assert.equal(body.user.email, email);
    assert.equal(body.resumes.length, 2, 'the full list travels too');
    assert.equal(body.history, undefined, 'history is paginated on its own screen');
  });

  it('reports a null resume for a fresh account', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'bootstrap-empty');

    const body = (await get(token, '/api/bootstrap')).json();

    assert.equal(body.resume, null);
    assert.deepEqual(body.resumes, []);
  });
});

describe('cross-user isolation', () => {
  it("never serves, mutates or deletes another user's data", async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const alice = await signedInUser(app, 'iso-alice');
    const bob = await signedInUser(app, 'iso-bob');

    const aliceResume = await upload(alice.token, 'alice.pdf', 'alice private text', ['alice']);
    const aliceEntry = (await saveScore(alice.token, aliceResume, 'Alice Job')).json().entry.id;
    await patch(alice.token, '/api/settings', {stopwords: ['alice']});

    // Reads answer 404, not 403 — confirming existence is itself a disclosure.
    for (const [label, response] of [
      ['resume detail', await get(bob.token, `/api/resumes/${aliceResume}`)],
      ['history detail', await get(bob.token, `/api/history/${aliceEntry}`)],
      ['activate', await put(bob.token, `/api/resumes/${aliceResume}/active`)],
      ['delete resume', await del(bob.token, `/api/resumes/${aliceResume}`)],
      ['delete history', await del(bob.token, `/api/history/${aliceEntry}`)],
    ] as const) {
      assert.equal(response.statusCode, 404, `${label} is invisible to another user`);
    }

    // Bob's own views are empty, and his settings are his own.
    assert.deepEqual((await get(bob.token, '/api/resumes')).json().resumes, []);
    assert.deepEqual((await get(bob.token, '/api/history')).json().history, []);
    assert.deepEqual((await get(bob.token, '/api/settings')).json().settings.stopwords, []);

    const bootstrap = (await get(bob.token, '/api/bootstrap')).json();
    assert.equal(bootstrap.resume, null);
    assert.equal(bootstrap.user.email, bob.email);

    // And none of those attempts damaged Alice's data.
    const aliceBootstrap = (await get(alice.token, '/api/bootstrap')).json();
    assert.equal(aliceBootstrap.resume.filename, 'alice.pdf');
    assert.equal(aliceBootstrap.resume.isActive, true);
    assert.deepEqual(aliceBootstrap.stopwords, ['alice']);
    assert.equal((await get(alice.token, '/api/history')).json().history.length, 1);
  });

  it('will not label history with a resume the caller does not own', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const alice = await signedInUser(app, 'label-alice');
    const bob = await signedInUser(app, 'label-bob');
    const aliceResume = await upload(alice.token, 'alice.pdf');

    const response = await saveScore(bob.token, aliceResume, 'Borrowed');

    assert.equal(response.statusCode, 404);
    assert.equal((await get(bob.token, '/api/history')).json().history.length, 0);
  });
});
