import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';

/**
 * Password hashing uses argon2id with the library defaults, which follow the
 * OWASP recommendations for memory/time cost.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {type: argon2.argon2id});
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash in the database — treat as a failed login, never a 500.
    return false;
  }
}

/**
 * A hash of a throwaway password, verified against when no user matches the
 * submitted email. Without this, "unknown email" returns measurably faster than
 * "wrong password" and the login endpoint becomes a user-enumeration oracle.
 */
let dummyHashPromise: Promise<string> | undefined;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

/** Opaque, URL-safe token for session cookies and emailed links. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored as SHA-256 digests, never in plaintext, so a database leak
 * cannot be replayed. SHA-256 (not argon2) is right here because the input is
 * already 256 bits of entropy — there is nothing to brute-force.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
