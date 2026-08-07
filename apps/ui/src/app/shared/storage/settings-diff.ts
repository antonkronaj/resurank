import type {PinImportance} from '@resurank/scoring/constants';
import type {PinnedTerm, SettingsSnapshot} from './storage-adapter';

/**
 * What changed between two settings snapshots, broken down per field so a
 * caller can render "3 stopwords added, term boost 'python' 1 → 2" instead of
 * just a boolean "these differ".
 *
 * Each `*Changed` field is `null` when that field is identical between the two
 * snapshots — same convention as `HistoryDetailModalComponent.rescoreOutcome`,
 * which also uses `null` for "nothing to show" rather than a separate flag.
 */
export interface SettingsDiff {
  stopwordsAdded: string[];
  stopwordsRemoved: string[];
  /** Boosts present in only one side, or present in both with a different value. */
  termBoostsChanged: Array<{term: string; from: number | null; to: number | null}>;
  missingKeywordEnabledChanged: {from: boolean; to: boolean} | null;
  missingKeywordMaxPenaltyChanged: {from: number; to: number} | null;
  pinnedTermsAdded: PinnedTerm[];
  pinnedTermsRemoved: PinnedTerm[];
  pinnedTermsImportanceChanged: Array<{term: string; from: PinImportance; to: PinImportance}>;
  preferenceMismatchEnabledChanged: {from: boolean; to: boolean} | null;
  preferenceMismatchMaxPenaltyChanged: {from: number; to: number} | null;
  preferenceMismatchTextChanged: {from: string; to: string} | null;
}

/**
 * Trim/lowercase/collapse-to-highest-importance, the same reduction
 * `canonicalPins` in apps/web/src/lib/settings-hash.ts applies before hashing.
 * Two snapshots that only look different because of casing or a duplicate
 * entry would already share one `settings_versions` row on the server (see
 * that file's docstring) — but the two *sides* of a diff are never
 * pre-canonicalised, so without this a raw compare would report noise
 * ("AWS" vs "aws") that never actually reached the scorer.
 */
function canonicalPins(pins: PinnedTerm[]): Map<string, PinImportance> {
  const rank = {low: 0, medium: 1, high: 2} as const;
  const collapsed = new Map<string, PinImportance>();
  for (const pin of pins) {
    const term = pin.term.trim().toLowerCase();
    if (!term) continue;
    const existing = collapsed.get(term);
    if (!existing || rank[pin.importance] > rank[existing]) collapsed.set(term, pin.importance);
  }
  return collapsed;
}

/** Structured diff of two settings snapshots — order-independent, dedupes like the scorer does. */
export function diffSettings(from: SettingsSnapshot, to: SettingsSnapshot): SettingsDiff {
  const fromStopwords = new Set(from.stopwords.map((w) => w.trim().toLowerCase()));
  const toStopwords = new Set(to.stopwords.map((w) => w.trim().toLowerCase()));
  const stopwordsAdded = [...toStopwords].filter((w) => !fromStopwords.has(w)).sort();
  const stopwordsRemoved = [...fromStopwords].filter((w) => !toStopwords.has(w)).sort();

  const boostTerms = new Set([...Object.keys(from.termBoosts), ...Object.keys(to.termBoosts)]);
  const termBoostsChanged = [...boostTerms]
    .filter((term) => from.termBoosts[term] !== to.termBoosts[term])
    .sort()
    .map((term) => ({
      term,
      from: from.termBoosts[term] ?? null,
      to: to.termBoosts[term] ?? null,
    }));

  const missingKeywordEnabledChanged =
    from.missingKeywordSettings.enabled !== to.missingKeywordSettings.enabled
      ? {from: from.missingKeywordSettings.enabled, to: to.missingKeywordSettings.enabled}
      : null;
  const missingKeywordMaxPenaltyChanged =
    from.missingKeywordSettings.maxPenalty !== to.missingKeywordSettings.maxPenalty
      ? {from: from.missingKeywordSettings.maxPenalty, to: to.missingKeywordSettings.maxPenalty}
      : null;

  const fromPins = canonicalPins(from.missingKeywordSettings.pinnedTerms);
  const toPins = canonicalPins(to.missingKeywordSettings.pinnedTerms);
  const pinnedTermsAdded = [...toPins]
    .filter(([term]) => !fromPins.has(term))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([term, importance]) => ({term, importance}));
  const pinnedTermsRemoved = [...fromPins]
    .filter(([term]) => !toPins.has(term))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([term, importance]) => ({term, importance}));
  const pinnedTermsImportanceChanged = [...fromPins]
    .filter(([term, importance]) => toPins.has(term) && toPins.get(term) !== importance)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([term, importance]) => ({term, from: importance, to: toPins.get(term)!}));

  const preferenceMismatchEnabledChanged =
    from.preferenceMismatchSettings.enabled !== to.preferenceMismatchSettings.enabled
      ? {from: from.preferenceMismatchSettings.enabled, to: to.preferenceMismatchSettings.enabled}
      : null;
  const preferenceMismatchMaxPenaltyChanged =
    from.preferenceMismatchSettings.maxPenalty !== to.preferenceMismatchSettings.maxPenalty
      ? {
          from: from.preferenceMismatchSettings.maxPenalty,
          to: to.preferenceMismatchSettings.maxPenalty,
        }
      : null;
  const preferenceMismatchTextChanged =
    from.preferenceMismatchSettings.text.trim() !== to.preferenceMismatchSettings.text.trim()
      ? {from: from.preferenceMismatchSettings.text, to: to.preferenceMismatchSettings.text}
      : null;

  return {
    stopwordsAdded,
    stopwordsRemoved,
    termBoostsChanged,
    missingKeywordEnabledChanged,
    missingKeywordMaxPenaltyChanged,
    pinnedTermsAdded,
    pinnedTermsRemoved,
    pinnedTermsImportanceChanged,
    preferenceMismatchEnabledChanged,
    preferenceMismatchMaxPenaltyChanged,
    preferenceMismatchTextChanged,
  };
}

export function isEmptyDiff(diff: SettingsDiff): boolean {
  return (
    diff.stopwordsAdded.length === 0 &&
    diff.stopwordsRemoved.length === 0 &&
    diff.termBoostsChanged.length === 0 &&
    diff.missingKeywordEnabledChanged === null &&
    diff.missingKeywordMaxPenaltyChanged === null &&
    diff.pinnedTermsAdded.length === 0 &&
    diff.pinnedTermsRemoved.length === 0 &&
    diff.pinnedTermsImportanceChanged.length === 0 &&
    diff.preferenceMismatchEnabledChanged === null &&
    diff.preferenceMismatchMaxPenaltyChanged === null &&
    diff.preferenceMismatchTextChanged === null
  );
}
