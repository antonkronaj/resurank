import {createHash} from 'node:crypto';
import type {MissingKeywordSettings, PreferenceMismatchSettings} from '@resurank/scoring';

/** The four settings that change a score, as sent alongside one. */
export interface SettingsPayload {
  stopwords: string[];
  termBoosts: Record<string, number>;
  missingKeywordSettings: MissingKeywordSettings;
  preferenceMismatchSettings: PreferenceMismatchSettings;
}

/**
 * Canonical form of a settings payload: two payloads that would produce the
 * same score must serialise identically here.
 *
 * This matters because the hash is what deduplicates `settings_versions`. A
 * naive `JSON.stringify` preserves insertion order, so re-saving the same term
 * boosts in a different order would look like a brand new settings state and
 * write a near-duplicate row on every subsequent score — exactly the row
 * explosion the shared table exists to avoid.
 *
 * Each ordering decision below is safe because the scorer already discards the
 * ordering itself:
 *
 * - `stopwords` is read into a `Set` before scoring (api.service.ts), so order
 *   and duplicates are not observable. Sorted and de-duplicated.
 * - `termBoosts` is a lookup keyed by term, so key order is not observable.
 *   Sorted by key.
 * - `pinnedTerms` is reduced exactly as the scorer reduces it — see
 *   `canonicalPins` below.
 *
 * Numbers and booleans are left alone: they are compared by value, and
 * rounding them here would make settings that really do differ hash alike.
 */
/**
 * Mirrors how `computeMissingKeywordPenalty` (packages/scoring/src/score.ts)
 * reduces pinned terms before scoring with them: trimmed and lowercased,
 * blanks dropped, duplicates collapsed onto their highest importance. Applying
 * the same reduction here is what lets settings that differ only cosmetically
 * — `Java` vs `java`, or the same term listed twice — share one version row
 * rather than minting a fresh one on the next score.
 *
 * That penalty derives from sums over these terms, so their order never
 * reaches the score, which is why sorting is safe. (Input order does survive
 * into `MatchResult.pinnedNotInJob`, but that is display ordering inside an
 * already-stored result, not something a settings version needs to explain.)
 *
 * This is deliberately coupled to the scorer: the claim a shared row makes is
 * "these settings score alike", so if that reduction ever changes, this must
 * follow it.
 */
function canonicalPins(
  pins: MissingKeywordSettings['pinnedTerms'],
): MissingKeywordSettings['pinnedTerms'] {
  const rank = {low: 0, medium: 1, high: 2} as const;
  const collapsed = new Map<string, MissingKeywordSettings['pinnedTerms'][number]>();

  for (const pin of pins) {
    const term = pin.term.trim().toLowerCase();
    if (!term) continue;
    const existing = collapsed.get(term);
    if (!existing || rank[pin.importance] > rank[existing.importance]) {
      collapsed.set(term, {term, importance: pin.importance});
    }
  }

  return [...collapsed.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

export function canonicalSettings(payload: SettingsPayload): string {
  const {stopwords, termBoosts, missingKeywordSettings, preferenceMismatchSettings} = payload;

  return JSON.stringify({
    stopwords: [...new Set(stopwords)].sort(),
    termBoosts: Object.fromEntries(
      Object.entries(termBoosts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    missingKeywordSettings: {
      enabled: missingKeywordSettings.enabled,
      maxPenalty: missingKeywordSettings.maxPenalty,
      pinnedTerms: canonicalPins(missingKeywordSettings.pinnedTerms),
    },
    preferenceMismatchSettings: {
      enabled: preferenceMismatchSettings.enabled,
      maxPenalty: preferenceMismatchSettings.maxPenalty,
      text: preferenceMismatchSettings.text,
    },
  });
}

/**
 * Stable content hash of a settings payload, unique per user in
 * `settings_versions.hash`. Not a security boundary — settings arrive
 * self-reported from the client, same as `embeddingModel` — so this only needs
 * to be collision-resistant enough that two genuinely different settings
 * states never share a row.
 */
export function hashSettings(payload: SettingsPayload): string {
  return createHash('sha256').update(canonicalSettings(payload)).digest('hex');
}
