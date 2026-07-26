import {z} from 'zod';
import {JOB_DESCRIPTION_CHAR_CAP} from '@resurank/scoring';

/**
 * Upper bound on password length. argon2's cost is driven by its parameters
 * rather than input size, but an unbounded field is still free CPU for an
 * attacker, so cap it well above any real passphrase.
 */
const MAX_PASSWORD_LENGTH = 200;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254) // RFC 5321 maximum
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(MAX_PASSWORD_LENGTH, 'Password is too long.');

export const nameSchema = z.string().trim().min(1).max(120).optional();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema` — rejecting a short password here with a
  // validation error would tell an attacker the policy applies to a real
  // account. Length rules belong on registration only.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const emailOnlySchema = z.object({email: emailSchema});

export const tokenQuerySchema = z.object({token: z.string().min(1).max(200)});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

/**
 * PATCH /api/users/me. Both fields are optional and `name: null` clears the
 * name, but an empty body is rejected — a request that changes nothing should
 * not report success.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'Provide a name or an email to update.',
  });

/** Account deletion is irreversible, so it re-checks the password. */
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/*
 * Domain routes.
 *
 * Note what these schemas deliberately do NOT bound: `text` on a resume and
 * `jobDescription` on a history entry. Those carry the caps from
 * @resurank/scoring and are checked in the route so they can answer 413
 * `payload_too_large` — a distinct, machine-readable condition the UI can
 * explain ("your resume is too long") rather than a generic validation error.
 * Everything else is bounded here purely to keep unbounded client input out of
 * jsonb columns.
 */

/** Long enough for any real term or stopword, short enough to bound the row. */
const TERM_MAX_LENGTH = 100;

const termSchema = z.string().trim().min(1).max(TERM_MAX_LENGTH);

export const idParamSchema = z.object({id: z.string().uuid()});

export const createResumeSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  text: z.string().min(1),
  // Extracted client-side during PDF parsing, exactly as the desktop build
  // does it — the server stores what the parser produced rather than
  // re-deriving it against settings that may have moved on since.
  terms: z.array(termSchema).max(10_000),
});

const pinnedTermSchema = z.object({
  term: termSchema,
  importance: z.enum(['low', 'medium', 'high']),
});

/** Penalties are fractions of the final score, so they live in [0, 1]. */
const penaltySchema = z.number().finite().min(0).max(1);

export const missingKeywordSettingsSchema = z.object({
  enabled: z.boolean(),
  maxPenalty: penaltySchema,
  pinnedTerms: z.array(pinnedTermSchema).max(500),
});

export const preferenceMismatchSettingsSchema = z.object({
  enabled: z.boolean(),
  maxPenalty: penaltySchema,
  text: z.string().max(JOB_DESCRIPTION_CHAR_CAP),
});

/**
 * Partial by design: the desktop StorageService saves each of these four keys
 * independently, so a PATCH that touches one key must not require the caller to
 * read and resend the other three.
 */
export const updateSettingsSchema = z
  .object({
    stopwords: z.array(termSchema).max(10_000).optional(),
    termBoosts: z
      .record(termSchema, z.number().finite().min(0).max(100))
      .refine((boosts) => Object.keys(boosts).length <= 5_000, {
        message: 'Too many term boosts.',
      })
      .optional(),
    missingKeywordSettings: missingKeywordSettingsSchema.optional(),
    preferenceMismatchSettings: preferenceMismatchSettingsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update.',
  });

export const createHistorySchema = z.object({
  resumeId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().trim().min(1).max(200),
  jobDescription: z.string().min(1),
  // Scoring runs client-side by design, so the result arrives computed. Only
  // `score` is read by the server (it is denormalised into its own column for
  // sorting); the rest is stored as opaque jsonb owned by @resurank/scoring.
  result: z.object({score: z.number().finite()}).passthrough(),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  resumeId: z.string().uuid().optional(),
});
