import {db} from '../db/client.js';
import {adminAuditLog, type AdminAuditAction} from '../db/schema.js';
import type {Tx} from './domain.js';

export interface RecordAdminActionInput {
  actorId: string | null;
  actorEmail: string;
  targetId?: string | null;
  targetEmail?: string | null;
  action: AdminAuditAction;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Writes one row to `admin_audit_log`. Every privileged mutation in
 * routes/admin.ts calls this — the delete/suspend endpoints are irreversible
 * or account-affecting, so an unlogged call is the failure this table exists
 * to prevent.
 *
 * Accepts an optional transaction handle (the same type `db.transaction`
 * hands its callback) so the audit row commits atomically with the mutation
 * it describes.
 */
export async function recordAdminAction(
  input: RecordAdminActionInput,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(adminAuditLog).values({
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    targetId: input.targetId ?? null,
    targetEmail: input.targetEmail ?? null,
    action: input.action,
    detail: input.detail ?? {},
    ip: input.ip ?? null,
  });
}
