import {z} from 'zod';
import {JOB_DESCRIPTION_CHAR_CAP} from '@resurank/scoring';

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

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.email !== undefined, {
    message: 'Provide a name or an email to update.',
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** Long enough for any real term or stopword, short enough to bound the row. */
const TERM_MAX_LENGTH = 100;

const termSchema = z.string().trim().min(1).max(TERM_MAX_LENGTH);

export const idParamSchema = z.object({id: z.string().uuid()});

export const createResumeSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  text: z.string().min(1),
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

const stopwordsSchema = z.array(termSchema).max(10_000);

const termBoostsSchema = z
  .record(termSchema, z.number().finite().min(0).max(100))
  .refine((boosts) => Object.keys(boosts).length <= 5_000, {
    message: 'Too many term boosts.',
  });

export const updateSettingsSchema = z
  .object({
    stopwords: stopwordsSchema.optional(),
    termBoosts: termBoostsSchema.optional(),
    missingKeywordSettings: missingKeywordSettingsSchema.optional(),
    preferenceMismatchSettings: preferenceMismatchSettingsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update.',
  });

export const settingsPayloadSchema = z.object({
  stopwords: stopwordsSchema,
  termBoosts: termBoostsSchema,
  missingKeywordSettings: missingKeywordSettingsSchema,
  preferenceMismatchSettings: preferenceMismatchSettingsSchema,
});

export const createHistorySchema = z.object({
  resumeId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().trim().min(1).max(200),
  jobDescription: z.string().min(1),
  // Scoring runs client-side by design, so the result arrives computed. Only
  // `score` is read by the server (it is denormalised into its own column for
  // sorting); the rest is stored as opaque jsonb owned by @resurank/scoring.
  result: z.object({score: z.number().finite()}).passthrough(),
  // Self-reported provenance from the client. Constrained rather than accepted
  // as free text: these are echoed back into the history UI
  embeddingModel: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(128).optional(),
  embeddingDtype: z.string().regex(/^[a-z0-9_]+$/).max(16).optional(),
  scoringVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/).max(32).optional(),
  /**
   * Optional on the same terms as the provenance above: the MCP server and any
   * client predating this simply do not send it, and a row without it records
   * that its settings are unknown rather than claiming today's.
   */
  settings: settingsPayloadSchema.optional(),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  resumeId: z.string().uuid().optional(),
});

/*
 * Admin routes.
 */

export const adminUserQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Free-text match against email prefix and name substring. */
  q: z.string().trim().max(200).optional(),
  status: z.enum(['all', 'active', 'suspended', 'admin']).default('all'),
});

export const adminRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const adminStatusSchema = z.object({
  disabled: z.boolean(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const adminDeleteSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const adminAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  targetId: z.string().uuid().optional(),
});
