import {and, eq, isNull} from 'drizzle-orm';
import {users, type User} from '../db/schema.js';
import {verifyPassword} from './crypto.js';
import type {ErrorCode} from './errors.js';
import type {Tx} from './domain.js';

/** A failed guardrail, ready to hand to `sendError`. */
export interface AdminGuardError {
  status: number;
  code: ErrorCode;
  message: string;
}

/**
 * Guardrails shared by the destructive admin endpoints (role change, suspend,
 * delete). Each returns `null` on success or an `AdminGuardError` describing
 * why the action was rejected — callers do:
 *
 *   const err = await checkActingPassword(actor, body.password);
 *   if (err) return sendError(reply, err.status, err.code, err.message);
 */

/** Re-checks the *acting* admin's own password, same as `DELETE /api/users/me`
 * — a session cookie alone should not be enough to take an irreversible
 * action against someone else's account. */
export async function checkActingPassword(
  actor: User,
  password: string,
): Promise<AdminGuardError | null> {
  if (await verifyPassword(actor.passwordHash, password)) return null;
  return {status: 401, code: 'invalid_credentials', message: 'Your password is incorrect.'};
}

/** An admin cannot demote, suspend, or delete themselves through this panel —
 * self-deletion stays on the existing password-gated Account page, and
 * self-demotion/-suspension while signed in as the only session watching for
 * it is a good way to lock yourself out with no one able to undo it. */
export function checkNotSelf(actor: User, targetUserId: string): AdminGuardError | null {
  if (actor.id !== targetUserId) return null;
  return {
    status: 409,
    code: 'conflict',
    message: 'Use your Account page to change your own account.',
  };
}

/**
 * Rejects an action that would leave zero active (non-suspended) admins.
 * Must run inside the same transaction as the mutation it guards, before the
 * mutation is applied.
 *
 * Locks every currently-active admin row with `FOR UPDATE` — not just the
 * target's row — so two concurrent requests demoting *different* admins can't
 * both read "someone else is still admin" and both proceed. The second
 * transaction blocks on the lock until the first commits, then re-reads a
 * count that already reflects the first change.
 */
export async function checkAdminQuorum(
  tx: Tx,
  targetUserId: string,
): Promise<AdminGuardError | null> {
  const activeAdmins = await tx
    .select({id: users.id})
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
    .for('update');

  const targetIsActiveAdmin = activeAdmins.some((admin) => admin.id === targetUserId);
  const remaining = activeAdmins.filter((admin) => admin.id !== targetUserId);

  if (targetIsActiveAdmin && remaining.length === 0) {
    return {
      status: 409,
      code: 'conflict',
      message: 'This is the last active admin — promote another user first.',
    };
  }
  return null;
}
