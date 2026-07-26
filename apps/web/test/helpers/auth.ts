import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {extractLink, waitForEmail} from './mailpit.js';

/** Shared account-lifecycle helpers for the integration suites. */

export const PASSWORD = 'correct horse battery staple';

/** Unique per run so repeated runs never collide on the email unique index. */
export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.test`;
}

/** Extracts the session cookie value from a set-cookie header. */
export function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
  const match = header.match(/rr_session=([^;]*)/);
  assert.ok(match, `expected an rr_session cookie in: ${header}`);
  return match[1];
}

/** Turns an absolute link from an email into an app.inject-ready path. */
export function linkPath(body: string): string {
  const url = new URL(extractLink(body));
  return url.pathname + url.search;
}

export async function register(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {email, password},
  });
  assert.equal(response.statusCode, 200);
}

/** Registers, then follows the emailed link to verify the address. */
export async function registerAndVerify(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await register(app, email, password);
  const mail = await waitForEmail(email, {subject: /verify/i});
  const response = await app.inject({method: 'GET', url: linkPath(mail.body)});
  assert.equal(response.statusCode, 302);
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  return app.inject({method: 'POST', url: '/api/auth/login', payload: {email, password}});
}

/** Registers, verifies and signs in, returning the live session cookie. */
export async function signedInUser(
  app: FastifyInstance,
  label: string,
  password = PASSWORD,
): Promise<{email: string; token: string}> {
  const email = uniqueEmail(label);
  await registerAndVerify(app, email, password);
  const response = await login(app, email, password);
  assert.equal(response.statusCode, 200);
  return {email, token: sessionCookie(response.headers['set-cookie'])};
}
