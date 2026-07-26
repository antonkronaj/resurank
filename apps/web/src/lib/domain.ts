import {and, eq, sql} from 'drizzle-orm';
import type {MatchResult} from '@resurank/scoring';
import {db} from '../db/client.js';
import {resumes, users, type Resume, type UserSettings} from '../db/schema.js';

/** The transaction handle drizzle hands to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Wire shapes for the domain routes.
 *
 * `ApiResume` is deliberately a superset of `ResumeData` in
 * frontend/src/app/storage.service.ts: the same four fields, plus the `id` and
 * `isActive` the desktop build never needed because it only ever held one
 * resume. That keeps one storage contract serving both builds.
 */

export interface ApiResume {
  id: string;
  filename: string;
  text: string;
  terms: string[];
  uploadedAt: string;
  isActive: boolean;
}

/**
 * List view. Omits `text` so listing N resumes does not ship N × 32k
 * characters; `chars` and `termCount` are computed in SQL, so the text never
 * leaves Postgres either. Matches what ApiService.getResume() actually renders.
 */
export interface ApiResumeSummary {
  id: string;
  filename: string;
  uploadedAt: string;
  isActive: boolean;
  chars: number;
  termCount: number;
}

export interface ApiHistorySummary {
  id: string;
  resumeId: string | null;
  resumeFilename: string | null;
  jobTitle: string;
  score: number;
  createdAt: string;
}

export interface ApiHistoryEntry extends ApiHistorySummary {
  jobDescription: string;
  result: MatchResult;
}

/** The four keys of StoreSnapshot that are not the resume. */
export interface ApiSettings {
  stopwords: string[];
  termBoosts: Record<string, number>;
  missingKeywordSettings: UserSettings['missingKeywordSettings'];
  preferenceMismatchSettings: UserSettings['preferenceMismatchSettings'];
}

/** Selected instead of the whole row so 32k-character texts stay in Postgres. */
export const resumeSummaryColumns = {
  id: resumes.id,
  filename: resumes.filename,
  uploadedAt: resumes.uploadedAt,
  isActive: resumes.isActive,
  chars: sql<number>`length(${resumes.text})`.mapWith(Number),
  termCount: sql<number>`jsonb_array_length(${resumes.terms})`.mapWith(Number),
};

type ResumeSummaryRow = {
  id: string;
  filename: string;
  uploadedAt: Date;
  isActive: boolean;
  chars: number;
  termCount: number;
};

export function toApiResume(row: Resume): ApiResume {
  return {
    id: row.id,
    filename: row.filename,
    text: row.text,
    terms: row.terms,
    uploadedAt: row.uploadedAt.toISOString(),
    isActive: row.isActive,
  };
}

export function toResumeSummary(row: ResumeSummaryRow): ApiResumeSummary {
  return {
    id: row.id,
    filename: row.filename,
    uploadedAt: row.uploadedAt.toISOString(),
    isActive: row.isActive,
    chars: row.chars,
    termCount: row.termCount,
  };
}

export function toApiSettings(row: UserSettings): ApiSettings {
  return {
    stopwords: row.stopwords,
    termBoosts: row.termBoosts,
    missingKeywordSettings: row.missingKeywordSettings,
    preferenceMismatchSettings: row.preferenceMismatchSettings,
  };
}

/**
 * Serialises every path that touches the active flag for one user.
 *
 * `resumes_one_active_per_user` rejects a second active row, and the "clear the
 * current active" UPDATE can only lock rows that already exist. Two concurrent
 * first-ever uploads therefore both find nothing to clear, both insert an
 * active row, and the second one dies on the index. Locking the (always
 * present) users row gives all of these paths something to queue on.
 */
export async function lockUserForResumeWrite(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select 1 from ${users} where ${users.id} = ${userId} for update`);
}

/**
 * Makes one resume the active one. The partial unique index
 * `resumes_one_active_per_user` rejects a second active row, so the previous
 * one must be cleared first — both statements run inside the caller's
 * transaction so the user is never left with zero or two active resumes.
 */
export async function activateResume(tx: Tx, userId: string, resumeId: string): Promise<void> {
  await tx
    .update(resumes)
    .set({isActive: false})
    .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)));

  await tx
    .update(resumes)
    .set({isActive: true})
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)));
}
