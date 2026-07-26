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
 * `PreferenceMismatchSettings` from frontend/src/app/storage.service.ts, and
 * `MatchResult` from @resurank/scoring.
 *
 * Note: resume PDFs are parsed client-side and never uploaded — `resumes.text`
 * holds extracted text only, and there is deliberately no binary column.
 */

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
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive uniqueness without requiring the citext extension,
    // which not every managed Postgres enables by default.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
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
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('score_history_user_created_idx').on(table.userId, table.createdAt),
    index('score_history_resume_id_idx').on(table.resumeId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type ScoreHistoryEntry = typeof scoreHistory.$inferSelect;
