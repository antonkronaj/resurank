
// Char caps before sending text to the embedding model. jina-embeddings-v2
// truncates at 8192 tokens (~32k chars in English), so we cap around there.
export const JOB_DESCRIPTION_CHAR_CAP = 32_000;
export const RESUME_CHAR_CAP = 32_000;

// Final score blend. Must sum to 1. Embedding captures semantic similarity
// (paraphrases, related concepts); TF-IDF anchors on shared keywords.
export const EMBEDDING_WEIGHT = 0.75;
export const TFIDF_WEIGHT = 0.25;

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
