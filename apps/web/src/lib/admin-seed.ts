import {eq} from 'drizzle-orm';
import {config} from '../config.js';
import {db} from '../db/client.js';
import {users} from '../db/schema.js';
import {recordAdminAction} from './audit.js';
import {hashPassword} from './crypto.js';
import {createUser, findUserByEmail} from './users.js';

/** Narrow shape of the pino-compatible logger Fastify hands us (`app.log`). */
interface SeedLogger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
}

/**
 * Ensures the bootstrap admin (ADMIN_EMAIL / ADMIN_PASSWORD) exists and is an
 * admin, on every startup.
 */
export async function seedAdminUser(log: SeedLogger): Promise<void> {
  const {email, password} = config.admin;
  if (!email || !password) {
    log.info('no ADMIN_EMAIL configured — skipping admin seed');
    return;
  }

  const existing = await findUserByEmail(email);

  if (!existing) {
    const user = await createUser(email, password);
    await db
      .update(users)
      .set({role: 'admin', emailVerified: true, disabledAt: null})
      .where(eq(users.id, user.id));
    await recordAdminAction({
      actorId: null,
      actorEmail: 'system',
      targetId: user.id,
      targetEmail: user.email,
      action: 'seed_admin',
      detail: {created: true},
    });
    log.info({email: user.email}, 'seeded bootstrap admin (created)');
    return;
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({
      role: 'admin',
      emailVerified: true,
      disabledAt: null,
      passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existing.id));
  await recordAdminAction({
    actorId: null,
    actorEmail: 'system',
    targetId: existing.id,
    targetEmail: existing.email,
    action: 'seed_admin',
    detail: {created: false},
  });
  log.info({email: existing.email}, 'seeded bootstrap admin (promoted existing user)');
}
