import type {FastifyReply} from 'fastify';
import type {ZodError} from 'zod';

/**
 * Structured error responses. Every failure returns `{error, message}` with a
 * stable machine-readable `error` code so the frontend can branch on it
 * (e.g. `email_not_verified` triggers the "resend verification" prompt).
 */
export type ErrorCode =
  | 'validation_failed'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'unauthenticated'
  | 'not_found'
  | 'conflict'
  | 'invalid_token'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal_error'
  /** Session resolved to a suspended account; the cookie is cleared too. */
  | 'account_disabled'
  /** Authenticated, but the account lacks the role a route requires. */
  | 'forbidden';

export function sendError(
  reply: FastifyReply,
  status: number,
  error: ErrorCode,
  message: string,
): FastifyReply {
  return reply.code(status).send({error, message});
}

export function sendValidationError(reply: FastifyReply, zodError: ZodError): FastifyReply {
  return reply.code(400).send({
    error: 'validation_failed' satisfies ErrorCode,
    message: 'Request validation failed.',
    details: zodError.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
