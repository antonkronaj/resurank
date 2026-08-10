import {desc, eq, sql} from 'drizzle-orm';
import {
  MISSING_KEYWORD_PENALTY_DEFAULT,
  PREFERENCE_MISMATCH_PENALTY_DEFAULT,
} from '@resurank/scoring';
import {db} from '../db/client.js';
import {
  resumes,
  scoreHistory,
  userSettings,
  users,
  type User,
  type UserRole,
} from '../db/schema.js';
import {hashPassword} from './crypto.js';

/** Shape returned to the client. Never includes `passwordHash`. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  /** Set while an email change is awaiting confirmation; null otherwise. */
  pendingEmail: string | null;
  role: UserRole;
  /** ISO timestamp while suspended; null otherwise. A user's own session is
   * always cleared before they could observe this as non-null on themselves. */
  disabledAt: string | null;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    pendingEmail: user.pendingEmail,
    role: user.role,
    disabledAt: user.disabledAt ? user.disabledAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Row shape for the admin user list — `PublicUser` plus counts an admin
 * needs to triage an account without opening its detail page. */
export interface AdminUserSummary extends PublicUser {
  resumeCount: number;
  historyCount: number;
  /** Most recent `sessions.last_seen_at` across all of the user's sessions,
   * or null if they have never signed in (e.g. an unverified registration). */
  lastSeenAt: string | null;
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

/** The full-account export shape, shared by the self-service and admin
 * export endpoints. */
export interface UserExport {
  exportedAt: string;
  user: PublicUser;
  settings: {
    stopwords: string[];
    termBoosts: Record<string, number>;
    missingKeywordSettings: unknown;
    preferenceMismatchSettings: unknown;
    updatedAt: Date;
  } | null;
  resumes: Array<{
    id: string;
    filename: string;
    text: string;
    terms: string[];
    uploadedAt: Date;
    isActive: boolean;
  }>;
  history: Array<{
    id: string;
    resumeId: string | null;
    resumeFilename: string | null;
    jobTitle: string;
    jobDescription: string;
    score: number;
    result: unknown;
    embeddingModel: string | null;
    embeddingDtype: string | null;
    scoringVersion: string | null;
    createdAt: Date;
  }>;
}

/**
 * Full data export for one account. Columns are listed explicitly rather
 * than selecting whole rows so a future internal column cannot leak into the
 * archive by accident, and so `user_id` is not repeated on every record.
 *
 * Shared by `GET /api/users/me/export` (self-service) and
 * `GET /api/admin/users/:id/export` (admin) — the query bodies are identical,
 * only the caller's authorization differs.
 */
export async function exportUserData(user: User): Promise<UserExport> {
  const [settings] = await db
    .select({
      stopwords: userSettings.stopwords,
      termBoosts: userSettings.termBoosts,
      missingKeywordSettings: userSettings.missingKeywordSettings,
      preferenceMismatchSettings: userSettings.preferenceMismatchSettings,
      updatedAt: userSettings.updatedAt,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id));

  const userResumes = await db
    .select({
      id: resumes.id,
      filename: resumes.filename,
      text: resumes.text,
      terms: resumes.terms,
      uploadedAt: resumes.uploadedAt,
      isActive: resumes.isActive,
    })
    .from(resumes)
    .where(eq(resumes.userId, user.id))
    .orderBy(desc(resumes.uploadedAt));

  const history = await db
    .select({
      id: scoreHistory.id,
      resumeId: scoreHistory.resumeId,
      resumeFilename: scoreHistory.resumeFilename,
      jobTitle: scoreHistory.jobTitle,
      jobDescription: scoreHistory.jobDescription,
      score: scoreHistory.score,
      result: scoreHistory.result,
      embeddingModel: scoreHistory.embeddingModel,
      embeddingDtype: scoreHistory.embeddingDtype,
      scoringVersion: scoreHistory.scoringVersion,
      createdAt: scoreHistory.createdAt,
    })
    .from(scoreHistory)
    .where(eq(scoreHistory.userId, user.id))
    .orderBy(desc(scoreHistory.createdAt));

  return {
    exportedAt: new Date().toISOString(),
    user: toPublicUser(user),
    settings: settings ?? null,
    resumes: userResumes,
    history,
  };
}
