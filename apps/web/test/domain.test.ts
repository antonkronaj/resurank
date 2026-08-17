import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {and, eq, sql} from 'drizzle-orm';
import type {FastifyInstance, LightMyRequestResponse} from 'fastify';
import {JOB_DESCRIPTION_CHAR_CAP, RESUME_CHAR_CAP, type MatchResult} from '@resurank/scoring';
import {buildApp} from '../src/app.js';
import {closeDatabase, db} from '../src/db/client.js';
import {MATCH_RESULT_MAX_BYTES, MAX_HISTORY_ROWS_PER_USER} from '../src/routes/history.js';
import {MAX_RESUMES_PER_USER} from '../src/routes/resumes.js';
import {resumes, scoreHistory, settingsVersions, users} from '../src/db/schema.js';
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

/**
 * Seeds history/resume rows directly in the database rather than through the
 * API — reaching the row-count caps (in the thousands) one HTTP write at a
 * time would make these tests painfully slow, and the caps themselves don't
 * care how the rows got there, only how many exist.
 */
async function seedHistoryRows(forUserId: string, rowCount: number): Promise<void> {
  await db.insert(scoreHistory).values(
    Array.from({length: rowCount}, () => ({
      userId: forUserId,
      jobTitle: 'seed',
      jobDescription: 'seed',
      score: 0,
      result: RESULT as unknown as MatchResult,
    })),
  );
}

async function seedResumeRows(forUserId: string, rowCount: number): Promise<void> {
  await db.insert(resumes).values(
    Array.from({length: rowCount}, (_, i) => ({
      userId: forUserId,
      filename: `seed-${i}.pdf`,
      text: 'seed',
      terms: [],
    })),
  );
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

  it('refuses a new resume once the per-user cap is reached', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'resume-row-cap');

    await seedResumeRows(await userId(email), MAX_RESUMES_PER_USER);

    const response = await post(token, '/api/resumes', {
      filename: 'one-too-many.pdf',
      text: 'one too many',
      terms: ['one'],
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'conflict');
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

  it('records score provenance and serves it back', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-provenance');
    const resumeId = await upload(token, 'cv.pdf');

    const created = await post(token, '/api/history', {
      resumeId,
      jobTitle: 'Provenance',
      jobDescription: 'a job that needs typing',
      result: RESULT,
      embeddingModel: 'Xenova/jina-embeddings-v2-small-en',
      embeddingDtype: 'q8',
      scoringVersion: '1.3.0',
    });
    assert.equal(created.statusCode, 201, created.payload);

    const [summary] = (await get(token, '/api/history')).json().history;
    assert.equal(summary.embeddingModel, 'Xenova/jina-embeddings-v2-small-en', 'model is on the summary');
    assert.equal(summary.embeddingDtype, undefined, 'dtype and version stay on the full entry');

    const {entry} = (await get(token, `/api/history/${summary.id}`)).json();
    assert.equal(entry.embeddingModel, 'Xenova/jina-embeddings-v2-small-en');
    assert.equal(entry.embeddingDtype, 'q8');
    assert.equal(entry.scoringVersion, '1.3.0');
  });

  it('stores nulls when provenance is omitted', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-no-provenance');
    const resumeId = await upload(token, 'cv.pdf');

    const response = await saveScore(token, resumeId, 'Legacy client');
    assert.equal(response.statusCode, 201, 'provenance is optional');

    const {entry} = (await get(token, `/api/history/${response.json().entry.id}`)).json();
    assert.equal(entry.embeddingModel, null);
    assert.equal(entry.scoringVersion, null);
  });

  it('rejects malformed provenance rather than storing it', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-bad-provenance');
    const resumeId = await upload(token, 'cv.pdf');

    const response = await post(token, '/api/history', {
      resumeId,
      jobTitle: 'Injected',
      jobDescription: 'a job',
      result: RESULT,
      embeddingModel: '<img src=x onerror=alert(1)>',
    });

    assert.equal(response.statusCode, 400, 'the model id is echoed into the UI, so it is constrained');
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

  it('refuses a result over the byte-size cap', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-result-cap');

    // Padded past MATCH_RESULT_MAX_BYTES with a field the server never reads
    // — the cap is on serialized size, not on any particular MatchResult key.
    const response = await post(token, '/api/history', {
      jobTitle: 'Oversized',
      jobDescription: 'a job',
      result: {...RESULT, padding: 'a'.repeat(MATCH_RESULT_MAX_BYTES)},
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_large');
  });

  it('accepts a well-formed result right under the byte-size cap', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'history-result-ok');

    // Comfortably under the cap after JSON-encoding overhead (quotes, other
    // RESULT keys), not exactly at the boundary.
    const response = await post(token, '/api/history', {
      jobTitle: 'Large but fine',
      jobDescription: 'a job',
      result: {...RESULT, padding: 'a'.repeat(MATCH_RESULT_MAX_BYTES - 1024)},
    });

    assert.equal(response.statusCode, 201, response.payload);
  });

  it('refuses a new history row once the per-user cap is reached', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'history-row-cap');

    await seedHistoryRows(await userId(email), MAX_HISTORY_ROWS_PER_USER);

    const response = await saveScore(token, null, 'One too many');

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'conflict');
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

/**
 * Provenance for the settings half of a score. The score itself is computed
 * client-side, so what is under test here is purely the bookkeeping: that a
 * run's settings are recorded, and that recording them does not write a fresh
 * row per score — the dedup is the whole reason these live in their own table
 * rather than inline on `score_history`.
 */
describe('settings versions', () => {
  const SETTINGS = {
    stopwords: ['the', 'and'],
    termBoosts: {java: 3},
    missingKeywordSettings: {
      enabled: true,
      maxPenalty: 0.25,
      pinnedTerms: [{term: 'java', importance: 'high'}],
    },
    preferenceMismatchSettings: {enabled: false, maxPenalty: 0.25, text: ''},
  };

  function saveWithSettings(token: string, settings: unknown): Res {
    return post(token, '/api/history', {
      resumeId: null,
      jobTitle: 'Engineer',
      jobDescription: 'a job that needs typing',
      result: RESULT,
      settings,
    });
  }

  /** Physical row identity — changes if Postgres rewrote the tuple. */
  async function tupleIdOf(versionId: string): Promise<string> {
    const result = await db.execute(
      sql`select ctid::text as ctid from settings_versions where id = ${versionId}`,
    );
    return (result.rows as unknown as {ctid: string}[])[0].ctid;
  }

  async function versionCount(userId: string): Promise<number> {
    const rows = await db
      .select({id: settingsVersions.id})
      .from(settingsVersions)
      .where(eq(settingsVersions.userId, userId));
    return rows.length;
  }

  async function settingsVersionIdOf(historyId: string): Promise<string | null> {
    const [row] = await db
      .select({settingsVersionId: scoreHistory.settingsVersionId})
      .from(scoreHistory)
      .where(eq(scoreHistory.id, historyId))
      .limit(1);
    return row.settingsVersionId;
  }

  it('stores the settings a score ran under', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-store');
    const id = await userId(email);

    const response = await saveWithSettings(token, SETTINGS);

    assert.equal(response.statusCode, 201);
    assert.equal(await versionCount(id), 1);
    assert.ok(await settingsVersionIdOf(response.json().entry.id), 'history row links to a version');
  });

  it('returns currentSettingsVersionId matching a row scored under it, and null before any settings are saved', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-current-null');

    const beforeAnySettings = (await get(token, '/api/history')).json();
    assert.equal(
      beforeAnySettings.currentSettingsVersionId,
      null,
      'no user_settings row exists yet, so there is nothing to match',
    );

    const saved = await saveWithSettings(token, SETTINGS);
    const list = (await get(token, '/api/history')).json();
    // `saveWithSettings` writes the row but never PATCHes /api/settings, so
    // user_settings still does not match — this stays null even though a
    // settings_versions row now exists for these exact settings.
    assert.equal(list.currentSettingsVersionId, null);
    assert.notEqual(await settingsVersionIdOf(saved.json().entry.id), null);
  });

  it('shares one version across repeated scores under identical settings', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-dedup');
    const id = await userId(email);

    const first = await saveWithSettings(token, SETTINGS);
    const second = await saveWithSettings(token, SETTINGS);

    assert.equal(await versionCount(id), 1, 'a second score must not mint a second version');
    assert.equal(
      await settingsVersionIdOf(first.json().entry.id),
      await settingsVersionIdOf(second.json().entry.id),
      'both scores point at the same version',
    );
  });

  it('does not rewrite the version row when settings have not changed', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-no-rewrite');
    const id = await userId(email);

    const first = await saveWithSettings(token, SETTINGS);
    const versionId = await settingsVersionIdOf(first.json().entry.id);
    assert.ok(versionId);
    const before = await tupleIdOf(versionId);

    await saveWithSettings(token, SETTINGS);

    // `on conflict do update` is a real UPDATE, so resolving through it would
    // move the tuple and leave a dead one behind on every single score. The
    // common path has to be a read. See resolveSettingsVersionId.
    assert.equal(await tupleIdOf(versionId), before, 'an unchanged settings row must not be rewritten');
    assert.equal(await versionCount(id), 1);
  });

  it('shares one version across differences the scorer discards', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-equivalent');
    const id = await userId(email);

    await saveWithSettings(token, SETTINGS);
    // Reordered stopwords and a differently-cased pin: same score, so this must
    // not read as a settings change. See lib/settings-hash.ts.
    await saveWithSettings(token, {
      ...SETTINGS,
      stopwords: ['and', 'the'],
      missingKeywordSettings: {
        ...SETTINGS.missingKeywordSettings,
        pinnedTerms: [{term: 'JAVA', importance: 'high'}],
      },
    });

    assert.equal(await versionCount(id), 1);
  });

  it('mints a new version when the settings really change', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-changed');
    const id = await userId(email);

    const before = await saveWithSettings(token, SETTINGS);
    const after = await saveWithSettings(token, {...SETTINGS, termBoosts: {java: 5}});

    assert.equal(await versionCount(id), 2);
    assert.notEqual(
      await settingsVersionIdOf(before.json().entry.id),
      await settingsVersionIdOf(after.json().entry.id),
      'the earlier score keeps pointing at the settings it actually ran under',
    );
  });

  it('keeps versions per-user, so identical settings never cross accounts', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const alice = await signedInUser(app, 'settings-alice');
    const bob = await signedInUser(app, 'settings-bob');

    const aliceScore = await saveWithSettings(alice.token, SETTINGS);
    const bobScore = await saveWithSettings(bob.token, SETTINGS);

    assert.equal(await versionCount(await userId(alice.email)), 1);
    assert.equal(await versionCount(await userId(bob.email)), 1);
    assert.notEqual(
      await settingsVersionIdOf(aliceScore.json().entry.id),
      await settingsVersionIdOf(bobScore.json().entry.id),
    );
  });

  it('matches currentSettingsVersionId to a score taken right after saving those settings', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-current-match');

    await patch(token, '/api/settings', {
      stopwords: SETTINGS.stopwords,
      termBoosts: SETTINGS.termBoosts,
      missingKeywordSettings: SETTINGS.missingKeywordSettings,
      preferenceMismatchSettings: SETTINGS.preferenceMismatchSettings,
    });
    const saved = await saveWithSettings(token, SETTINGS);
    const list = (await get(token, '/api/history')).json();

    assert.notEqual(list.currentSettingsVersionId, null);
    assert.equal(list.currentSettingsVersionId, await settingsVersionIdOf(saved.json().entry.id));

    const [row] = list.history;
    assert.equal(
      row.settingsVersionId,
      list.currentSettingsVersionId,
      'this row should read as current, not stale, in the badge logic',
    );
  });

  it('returns the resolved settings on the detail endpoint, not just their id', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-detail-echo');

    const created = await saveWithSettings(token, SETTINGS);
    const {entry} = (await get(token, `/api/history/${created.json().entry.id}`)).json();

    assert.deepEqual(entry.settings, SETTINGS, 'detail view resolves the id back to the payload');
  });

  it('returns null settings on the detail endpoint when none were sent', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {token} = await signedInUser(app, 'settings-detail-absent');

    const created = await saveScore(token, null, 'No settings');
    const {entry} = (await get(token, `/api/history/${created.json().entry.id}`)).json();

    assert.equal(entry.settings, null);
  });

  it('records unknown rather than current settings when a client sends none', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const {email, token} = await signedInUser(app, 'settings-absent');
    const id = await userId(email);

    const response = await saveScore(token, null, 'No settings');

    assert.equal(response.statusCode, 201);
    assert.equal(await versionCount(id), 0, 'nothing is invented for a client that sent none');
    assert.equal(await settingsVersionIdOf(response.json().entry.id), null);
  });
});
