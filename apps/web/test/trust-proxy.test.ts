import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {sql} from 'drizzle-orm';
import type {FastifyInstance, LightMyRequestResponse} from 'fastify';
import {buildApp} from '../src/app.js';
import {closeDatabase, db} from '../src/db/client.js';
import {hashToken} from '../src/lib/crypto.js';
import {sessions, users} from '../src/db/schema.js';
import {PASSWORD, linkPath, sessionCookie, uniqueEmail} from './helpers/auth.js';
import {clearMailbox, isMailpitRunning, waitForEmail} from './helpers/mailpit.js';

/**
 * Exercises the trustProxy hop-count boundary in ../src/app.ts directly, via
 * buildApp's `trustProxy` test override (NODE_ENV stays "test" here, so this
 * doesn't need NODE_ENV=production's other requirements like
 * RESEND_API_KEY). See the comment above `trustProxy` in app.ts and
 * docs/deployment-runbook.md §5: `trustProxy: true` lets a client set its
 * own request.ip by sending X-Forwarded-For itself, which defeats every
 * rate limit (keyed on request.ip) and forges sessions.ip /
 * admin_audit_log.ip. `trustProxy: 1` trusts only the one real reverse
 * proxy hop in front of the app and takes the client IP from the entry just
 * before it, which a client cannot control.
 *
 * Every case here simulates the same fixed reverse-proxy connection
 * (remoteAddress) across requests — as if all requests arrive through the
 * one real load balancer — while the *attacker* varies what they put in
 * X-Forwarded-For. The last entry in that header is what the real proxy
 * itself would have appended based on the TCP connection it saw, so it's
 * the one hop `trustProxy: 1` is meant to trust; everything before it is
 * attacker-controlled and untrusted.
 */

const PROXY_ADDRESS = '10.0.0.5';
const REAL_CLIENT_IP = '203.0.113.9';

let mailpitUp = false;

before(async () => {
  mailpitUp = await isMailpitRunning();
  if (mailpitUp) await clearMailbox();
});

after(async () => {
  await db.delete(users).where(sql`${users.email} like '%@example.test'`);
  await closeDatabase();
});

function attemptLogin(app: FastifyInstance, xForwardedFor: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: PROXY_ADDRESS,
    headers: {'x-forwarded-for': xForwardedFor},
    payload: {email: uniqueEmail('spoof'), password: 'wrong password'},
  });
}

describe('trustProxy hop count', () => {
  it('a distinct X-Forwarded-For per request does not defeat the login rate limit', async () => {
    const app = await buildApp({rateLimitMax: 3, trustProxy: 1});
    await app.ready();

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        // First entry is attacker-controlled and changes every request; the
        // last entry (what the real proxy would have appended) stays fixed.
        const response = await attemptLogin(app, `198.51.100.${i}, ${REAL_CLIENT_IP}`);
        statuses.push(response.statusCode);
      }

      assert.deepEqual(statuses.slice(0, 3), [401, 401, 401], 'first three attempts are processed');
      assert.equal(statuses[3], 429, 'fourth attempt is blocked despite a different XFF each time');
    } finally {
      await app.close();
    }
  });

  it('trustProxy: true — the old config — is defeated by the same spoof', async () => {
    const app = await buildApp({rateLimitMax: 3, trustProxy: true});
    await app.ready();

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await attemptLogin(app, `198.51.100.${i}, ${REAL_CLIENT_IP}`);
        statuses.push(response.statusCode);
      }

      assert.ok(
        statuses.every((s) => s === 401),
        'with trustProxy: true every request gets a fresh bucket — the bug this fix replaces',
      );
    } finally {
      await app.close();
    }
  });

  it('a request arriving through the real proxy records the client IP, not the proxy IP, in sessions.ip', async (t) => {
    if (!mailpitUp) return t.skip('Mailpit not running');
    const app = await buildApp({rateLimitMax: 10_000, trustProxy: 1});
    await app.ready();

    try {
      const email = uniqueEmail('proxy-ip');
      function inject(
        url: string,
        method: 'GET' | 'POST',
        payload?: Record<string, string>,
      ): Promise<LightMyRequestResponse> {
        return app.inject({
          method,
          url,
          remoteAddress: PROXY_ADDRESS,
          headers: {'x-forwarded-for': REAL_CLIENT_IP},
          payload,
        });
      }

      const register = await inject('/api/auth/register', 'POST', {email, password: PASSWORD});
      assert.equal(register.statusCode, 200);

      const mail = await waitForEmail(email, {subject: /verify/i});
      const verify = await inject(linkPath(mail.body), 'GET');
      assert.equal(verify.statusCode, 302);

      const login = await inject('/api/auth/login', 'POST', {email, password: PASSWORD});
      assert.equal(login.statusCode, 200);
      const token = sessionCookie(login.headers['set-cookie']);

      const [row] = await db
        .select()
        .from(sessions)
        .where(sql`${sessions.id} = ${hashToken(token)}`);

      assert.ok(row, 'session row was written');
      assert.equal(row.ip, REAL_CLIENT_IP, 'stores the real client IP from XFF, not the proxy address');
      assert.notEqual(row.ip, PROXY_ADDRESS);
    } finally {
      await app.close();
    }
  });
});
