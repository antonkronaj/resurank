import {sql} from 'drizzle-orm';
import {
  MISSING_KEYWORD_PENALTY_DEFAULT,
  PREFERENCE_MISMATCH_PENALTY_DEFAULT,
} from '@resurank/scoring';
import {db} from '../db/client.js';
import {userSettings, users, type User} from '../db/schema.js';
import {hashPassword} from './crypto.js';

/** Shape returned to the client. Never includes `passwordHash`. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** Set while an email change is awaiting confirmation; null otherwise. */
  pendingEmail: string | null;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    pendingEmail: user.pendingEmail,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Case-insensitive lookup matching the `users_email_lower_unique` index, so a
 * caller cannot register `User@x.com` when `user@x.com` already exists.
 */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return user;
}

/**
 * Creates the user and their settings row together. Defaults mirror the desktop
 * app's DEFAULT_MISSING_KEYWORD_SETTINGS / DEFAULT_PREFERENCE_MISMATCH_SETTINGS
 * so a new web account starts in the same state as a fresh desktop install.
 */
export async function createUser(
  email: string,
  password: string,
  name?: string,
): Promise<User> {
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({email, passwordHash, name: name ?? null})
      .returning();

    await tx.insert(userSettings).values({
      userId: user.id,
      stopwords: [],
      termBoosts: {},
      missingKeywordSettings: {
        enabled: false,
        maxPenalty: MISSING_KEYWORD_PENALTY_DEFAULT,
        pinnedTerms: [],
      },
      preferenceMismatchSettings: {
        enabled: false,
        maxPenalty: PREFERENCE_MISMATCH_PENALTY_DEFAULT,
        text: '',
      },
    });

    return user;
  });
}
