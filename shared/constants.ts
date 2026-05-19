// UI input cap — how much text the user can paste before the counter turns red.
export const JOB_DESCRIPTION_CHAR_CAP = 32_000;
export const RESUME_CHAR_CAP = 32_000;

// Embedding cap — applied *after* sanitization (strip emoji, URLs, Markdown).
// Emoji sequences and URLs tokenize far denser than plain English (~1 token per
// 4 chars), so we keep a conservative limit to avoid ONNX WASM memory faults.
export const EMBEDDING_CHAR_CAP = 6_000;

// Token cap passed to the embedding model. Inputs are pre-truncated at
// EMBEDDING_CHAR_CAP characters (~1.5k tokens worst case), so 2048 is the
// smallest power-of-two ceiling that never truncates real content. Attention
// is O(n²), so keeping this tight matters.
export const EMBEDDING_MAX_LENGTH = 2048;

// Final score blend. Must sum to 1. Embedding captures semantic similarity
// (paraphrases, related concepts); TF-IDF anchors on shared keywords.
export const EMBEDDING_WEIGHT = 0.60;
export const TFIDF_WEIGHT = 0.40;

// Of the resume's TF-IDF terms sorted by weight desc, how many count as
// "high signal." Only terms in this top slice can show up as matched
// terms or contribute to the overlap bonus.
export const TOP_TERMS_FOR_MATCHING = 100;

// Display cap on the matched-term chips shown in the result panel.
// Cosmetic only — doesn't affect the score.
export const MAX_MATCHED_TERMS = 25;

// Display cap on the JD weighted-keywords list. The raw-counts list is
// not capped.
export const TOP_TERMS_FOR_BREAKDOWN = 50;

// Overlap bonus: a small kicker added to the TF-IDF cosine. Linear from
// 0 to OVERLAP_BONUS_MAX as the match count climbs from 0 to THRESHOLD;
// flat at MAX after that. With THRESHOLD=30 and MAX=0.2, each match adds
// ~0.67% until we hit 30, then no further gain.
export const OVERLAP_BONUS_THRESHOLD = 30;
export const OVERLAP_BONUS_MAX = 0.2;

// Divergence penalty: when TF-IDF is near zero the embedding is likely a
// false positive (abstract semantic overlap with no real keyword match).
// Smoothly reduce the embedding weight as TF-IDF falls below the gate.
// At tfidf >= GATE: normal weights (0.7/0.3) apply unchanged.
// At tfidf = 0:     embedding weight drops to MIN_EMBEDDING_WEIGHT.
export const DIVERGENCE_TFIDF_GATE = 0.15;
export const DIVERGENCE_MIN_EMBEDDING_WEIGHT = 0.10;

// Language detection: flag the JD as likely non-English when more than
// this fraction of its alphabetic characters are non-ASCII.
export const NON_ENGLISH_CHAR_RATIO = 0.03;

// Critical-keyword penalty: default slider value (used when no settings
// file exists yet) and hard upper bound. The penalty is
// `coverageGap * maxPenalty`, so a value of 0.25 means a JD where every
// critical term is missing from the resume drops the final score by up
// to 25 percentage points.
export const MISSING_KEYWORD_PENALTY_DEFAULT = 0.25;
export const MISSING_KEYWORD_PENALTY_LIMIT = 0.5;

// Display cap on the missing-keyword chips shown next to matched chips.
// Cosmetic only — doesn't affect the score.
export const MAX_MISSING_TERMS = 25;

// Per-pin importance multiplier. Symmetric around 1 so a "medium" pin
// behaves identically to the original unweighted pins — turning a pin
// to "high" doubles its contribution, "low" halves it.
export type PinImportance = 'low' | 'medium' | 'high';
export const PIN_IMPORTANCE_MULTIPLIERS: Record<PinImportance, number> = {
  low: 0.5,
  medium: 1,
  high: 2,
};
export const DEFAULT_PIN_IMPORTANCE: PinImportance = 'medium';
