import {config} from '../config.js';

export interface DomainRoutesOptions {
  /**
   * Overrides the rate limit for authenticated writes. Tests raise it so the
   * flow suites are not throttled.
   */
  rateLimitMax?: number;
}

/**
 * Throttle for authenticated writes — uploads, score saves, settings changes.
 * Looser than the auth throttle: these are ordinary app usage by someone who
 * has already proven who they are, not credential guessing.
 */
export function writeLimit(options: DomainRoutesOptions) {
  return {
    rateLimit: {
      max: options.rateLimitMax ?? config.rateLimit.writeMax,
      timeWindow: config.rateLimit.writeWindow,
    },
  };
}
