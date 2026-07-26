export type ScoreTier = 'poor' | 'fair' | 'good' | 'great';

/** Shared by the Score screen's own ring and the web History list's rings. */
export function scoreTier(score: number): ScoreTier {
  if (score < 0.3) return 'poor';
  if (score < 0.5) return 'fair';
  if (score < 0.7) return 'good';
  return 'great';
}
