import {config} from '../config.js';
import {deleteExpiredEmailTokens} from './email-tokens.js';
import {deleteExpiredSessions} from './sessions.js';

/** Narrow shape of the pino-compatible logger Fastify hands us (`app.log`). */
interface CleanupLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Sweeps expired sessions and email tokens in one pass. */
export async function runCleanup(): Promise<void> {
  await deleteExpiredSessions();
  await deleteExpiredEmailTokens();
}

export function startCleanupScheduler(log: CleanupLogger): NodeJS.Timeout {
  void runCleanup().catch((error) => log.error({error}, 'cleanup sweep failed'));

  const timer = setInterval(() => {
    void runCleanup().catch((error) => log.error({error}, 'cleanup sweep failed'));
  }, config.cleanupIntervalMs);
  timer.unref();

  return timer;
}
