import {and, eq, gt, isNull, lt, or} from 'drizzle-orm';
import {db} from '../db/client.js';
import {emailTokens, type EmailTokenType} from '../db/schema.js';
import {generateToken, hashToken} from './crypto.js';

const TTL_MS: Record<EmailTokenType, number> = {
  verify: 24 * 60 * 60 * 1000, // 24 hours
  reset: 60 * 60 * 1000, // 1 hour — shorter, it grants account takeover
  change_email: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Consumed tokens are kept briefly after use rather than deleted inline by consumeEmailToken
 */
const USED_TOKEN_RETENTION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Drops every outstanding token of a type. Used both to keep one live link per
 * inbox and to cancel anything an attacker set up while they held a session —
 * a password change must not leave a usable `change_email` token behind.
 */
export async function revokeEmailTokens(userId: string, type: EmailTokenType): Promise<void> {
  await db
    .delete(emailTokens)
    .where(
      and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)),
    );
}

export async function issueEmailToken(userId: string, type: EmailTokenType): Promise<string> {
  // Only the newest link in the user's inbox should work.
  await revokeEmailTokens(userId, type);

  const token = generateToken();
  await db.insert(emailTokens).values({
    userId,
    tokenHash: hashToken(token),
    type,
    expiresAt: new Date(Date.now() + TTL_MS[type]),
  });

  return token;
}

/**
 * Atomically marks a token used and returns its owner. The `usedAt is null`
 * guard is part of the UPDATE, so two concurrent requests carrying the same
 * token cannot both succeed.
 */
export async function consumeEmailToken(
  token: string,
  type: EmailTokenType,
): Promise<string | null> {
  const [row] = await db
    .update(emailTokens)
    .set({usedAt: new Date()})
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.type, type),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({userId: emailTokens.userId});

  return row?.userId ?? null;
}

/** Removes rows past their expiry, plus consumed rows past the retention grace period. */
export async function deleteExpiredEmailTokens(): Promise<void> {
  const now = new Date();
  await db
    .delete(emailTokens)
    .where(
      or(
        lt(emailTokens.expiresAt, now),
        lt(emailTokens.usedAt, new Date(now.getTime() - USED_TOKEN_RETENTION_MS)),
      ),
    );
}
