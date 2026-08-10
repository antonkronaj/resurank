import {sql} from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  MatchResult,
  MissingKeywordSettings,
  PreferenceMismatchSettings,
} from '@resurank/scoring';

/**
 * Shapes here mirror the desktop app's persisted types so one storage contract
 * serves both builds: `ResumeData`, `MissingKeywordSettings` and
 * `PreferenceMismatchSettings` from apps/ui/src/app/storage.service.ts, and
 * `MatchResult` from @resurank/scoring.
 *
 * Note: resume PDFs are parsed client-side and never uploaded — `resumes.text`
 * holds extracted text only, and there is deliberately no binary column.
 */

export const userRoles = ['user', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    emailVerified: boolean('email_verified').notNull().default(false),
    /**
     * Address awaiting confirmation from a `change_email` token. `email` only
     * moves here once the user clicks the link sent to the new address, so a
     * typo can never strand an account on an inbox nobody owns.
     */
    pendingEmail: text('pending_email'),
    /**
     * Staff axis, not a billing/plan tier — see the note on `role` vs a future
     * subscription concept in the admin feature plan. Set by an operator
     * (bootstrapped from ADMIN_EMAIL/ADMIN_PASSWORD, see lib/admin-seed.ts, or
     * granted by an existing admin) and rarely changes.
     */
    role: text('role').$type<UserRole>().notNull().default('user'),
    /** Non-null = suspended: requireAuth rejects the session and the app
     * treats every existing session as revoked. Set only by an admin. */
    disabledAt: timestamp('disabled_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive uniqueness without requiring the citext extension,
    // which not every managed Postgres enables by default.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    // Default ordering for the admin user list.
    index('users_created_at_idx').on(table.createdAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 of the opaque token in the cookie. The raw token is never stored,
    // so a database leak cannot be replayed as a live session.
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', {withTimezone: true}).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (table) => [
    // Supports "sign out everywhere" and per-user session listing.
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const emailTokenTypes = ['verify', 'reset', 'change_email'] as const;
export type EmailTokenType = (typeof emailTokenTypes)[number];

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    // SHA-256 of the token in the emailed link, for the same reason as sessions.
    tokenHash: text('token_hash').notNull(),
    type: text('type').$type<EmailTokenType>().notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    usedAt: timestamp('used_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_tokens_token_hash_unique').on(table.tokenHash),
    index('email_tokens_user_id_type_idx').on(table.userId, table.type),
  ],
);

export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    filename: text('filename').notNull(),
    /** Extracted text only — the PDF binary never leaves the client. */
    text: text('text').notNull(),
    terms: jsonb('terms').$type<string[]>().notNull().default([]),
    /** Named `uploaded_at` to match ResumeData.uploadedAt on the desktop side. */
    uploadedAt: timestamp('uploaded_at', {withTimezone: true}).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(false),
  },
  (table) => [
    index('resumes_user_id_idx').on(table.userId),
    // At most one active resume per user, enforced in the database rather than
    // by a users.active_resume_id column — that would create a circular FK
    // between users and resumes and leave the invariant to application code.
    uniqueIndex('resumes_one_active_per_user')
      .on(table.userId)
      .where(sql`${table.isActive}`),
  ],
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, {onDelete: 'cascade'}),
  stopwords: jsonb('stopwords').$type<string[]>().notNull().default([]),
  termBoosts: jsonb('term_boosts').$type<Record<string, number>>().notNull().default({}),
  missingKeywordSettings: jsonb('missing_keyword_settings')
    .$type<MissingKeywordSettings>()
    .notNull(),
  preferenceMismatchSettings: jsonb('preference_mismatch_settings')
    .$type<PreferenceMismatchSettings>()
    .notNull(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

/**
 * Immutable snapshots of the four scoring settings, one row per distinct state
 * a user has scored under. `user_settings` holds what is current; this holds
 * what a given score actually ran with, so a stored score stays explainable
 * after the settings that produced it are edited.
 *
 * A separate table rather than columns on `score_history` because these are
 * neither scalar nor low-cardinality — the reasoning that put `embedding_model`
 * inline cuts the other way here. A stopword list runs to thousands of entries
 * and changes far less often than scores are recorded, so inlining it would
 * copy the same large blob onto every row. Sharing one row across every score
 * taken under it also makes "did these two runs use the same settings?" an id
 * comparison instead of a deep object diff.
 *
 * Rows are never updated or individually deleted; they are only removed when
 * their user is. Editing settings writes a new version (or reuses a matching
 * one) rather than mutating an existing row, which is what makes an old
 * `score_history.settings_version_id` still mean what it meant when written.
 */
export const settingsVersions = pgTable(
  'settings_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    /**
     * sha256 over the canonicalised payload below — see lib/settings-hash.ts,
     * which owns the canonical form. Unique per user so re-saving identical
     * settings reuses this row instead of writing a near-duplicate on every
     * score. Stored rather than derived on read so the uniqueness is enforced
     * by the database rather than by every caller remembering to check.
     */
    hash: text('hash').notNull(),
    // The same four payload columns as `user_settings`, frozen at score time.
    stopwords: jsonb('stopwords').$type<string[]>().notNull(),
    termBoosts: jsonb('term_boosts').$type<Record<string, number>>().notNull(),
    missingKeywordSettings: jsonb('missing_keyword_settings')
      .$type<MissingKeywordSettings>()
      .notNull(),
    preferenceMismatchSettings: jsonb('preference_mismatch_settings')
      .$type<PreferenceMismatchSettings>()
      .notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('settings_versions_user_hash_idx').on(table.userId, table.hash)],
);

export const scoreHistory = pgTable(
  'score_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    // Nulled rather than cascaded when a resume is deleted, so a user's scoring
    // history survives removing the resume it was scored against.
    resumeId: uuid('resume_id').references(() => resumes.id, {onDelete: 'set null'}),
    resumeFilename: text('resume_filename'),
    jobTitle: text('job_title').notNull(),
    jobDescription: text('job_description').notNull(),
    /**
     * Denormalised from result.score so history can be sorted without unpacking
     * jsonb. `MatchResult.score` is an unrounded float (score.ts:271), so this
     * is double precision — an integer column would silently truncate it.
     */
    score: doublePrecision('score').notNull(),
    result: jsonb('result').$type<MatchResult>().notNull(),
    /**
     * How the score was produced. Three columns rather than one jsonb blob:
     * these are scalar, low-cardinality and always arrive together, so
     * `group by scoring_version` stays possible without unpacking jsonb — the
     * same reasoning that gives `score` its own column. Kept out of `result`
     * because that is @resurank/scoring's `MatchResult` contract, shared with
     * the MCP server, and provenance is about the run, not the score.
     *
     * Nullable: rows written before this existed genuinely do not know, and
     * the desktop build does not record history at all.
     *
     * Backfill decision (applies to every nullable provenance column below,
     * including `resume_id` above and `settings_version_id` further down):
     * there is no backfill. A null stays null forever rather than being
     * populated with a guess or the current value, because both would assert
     * a provenance nobody actually recorded — and every reader of these
     * columns must in turn treat null as "unknown", never as "same as now".
     * The UI enforces this uniformly: `scoredWithOther*` in
     * apps/ui/src/app/web/history/{history,history-detail-modal}.component.ts
     * all early-return `false` on a null column (unmarked rather than flagged
     * stale), and history-detail-modal.component.html shows an explicit
     * "recorded before ResuRank tracked which X produced a score" line rather
     * than rendering an empty or zeroed section.
     */
    embeddingModel: text('embedding_model'),
    embeddingDtype: text('embedding_dtype'),
    scoringVersion: text('scoring_version'),
    /**
     * The settings this score ran under. Nullable on the same terms as the
     * three columns above: rows written before this existed genuinely do not
     * know, and reading null as "the current settings" would assert a
     * provenance nobody recorded.
     *
     * `set null` rather than cascade so a settings version can never take
     * history rows with it — matching `resume_id`. In practice versions are
     * only removed with their user, which drops this row anyway.
     */
    settingsVersionId: uuid('settings_version_id').references(() => settingsVersions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('score_history_user_created_idx').on(table.userId, table.createdAt),
    index('score_history_resume_id_idx').on(table.resumeId),
    /**
     * Not for any query the app runs — for the foreign key. Postgres enforces
     * `on delete set null` by looking up referencing rows, and without this it
     * does that with a sequential scan of the whole table, once per settings
     * version being removed. Deleting one account would otherwise scan
     * `score_history` once for every settings state that account ever scored
     * under. `score_history_resume_id_idx` above exists for exactly the same
     * reason on the identically-shaped `resume_id`.
     */
    index('score_history_settings_version_id_idx').on(table.settingsVersionId),
  ],
);

export const adminAuditActions = [
  'delete_user',
  'suspend_user',
  'reinstate_user',
  'grant_admin',
  'revoke_admin',
  'force_verify',
  'revoke_sessions',
  'seed_admin',
] as const;
export type AdminAuditAction = (typeof adminAuditActions)[number];

/**
 * One row per privileged action taken through /api/admin/*. `actorId` is
 * nullable and `onDelete: 'set null'` rather than cascade — deleting an admin
 * must not erase the record of what they did, so `actorEmail` is captured
 * alongside it as a snapshot for when the FK has gone null. `targetId` has no
 * FK at all: after `delete_user` the target row is gone, and the log must
 * still say who it was, so `targetEmail` is the only durable reference.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, {onDelete: 'set null'}),
    actorEmail: text('actor_email').notNull(),
    targetId: uuid('target_id'),
    targetEmail: text('target_email'),
    action: text('action').$type<AdminAuditAction>().notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_log_created_at_idx').on(table.createdAt),
    index('admin_audit_log_target_id_idx').on(table.targetId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type SettingsVersion = typeof settingsVersions.$inferSelect;
export type ScoreHistoryEntry = typeof scoreHistory.$inferSelect;
export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogEntry = typeof adminAuditLog.$inferInsert;
