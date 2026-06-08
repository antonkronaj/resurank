import {EXTRA_STOPWORDS} from './stopwords.js';
import {
  DIVERGENCE_MIN_EMBEDDING_WEIGHT,
  DIVERGENCE_TFIDF_GATE,
  EMBEDDING_CHAR_CAP,
  EMBEDDING_WEIGHT,
  MAX_MATCHED_TERMS,
  MAX_MISSING_TERMS,
  NON_ENGLISH_CHAR_RATIO,
  OVERLAP_BONUS_MAX,
  OVERLAP_BONUS_THRESHOLD,
  PIN_IMPORTANCE_MULTIPLIERS,
  PREFERENCE_MISMATCH_FLOOR,
  TFIDF_WEIGHT,
  TOP_TERMS_FOR_BREAKDOWN,
  TOP_TERMS_FOR_MATCHING,
  RESUME_INDEX,
  JOB_INDEX,
} from './constants.js';
import {extractTerms} from './terms.js';
import {
  DEFAULT_MISSING_KEYWORD_SETTINGS,
  DEFAULT_PREFERENCE_MISMATCH_SETTINGS,
  type Embedder,
  type JobInput,
  type MatchResult,
  type MissingKeywordSettings,
  type PreferenceMismatchSettings,
  type ScoreOptions,
  type TermCount,
  type TermWeight,
} from './types.js';

function dotProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normSq(weights: Map<string, number>): number {
  let s = 0;
  for (const w of weights.values()) s += w * w;
  return s;
}

function normalizeBoosts(boosts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(boosts)) {
    if (Number.isFinite(v) && v > 0) out[k.toLowerCase()] = v;
  }
  return out;
}

class TfIdf {
  private docs: Map<string, number>[] = [];

  addDocument(terms: string[]): void {
    const freq = new Map<string, number>();
    for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1);
    this.docs.push(freq);
  }

  listTerms(d: number): {term: string; tfidf: number}[] {
    const doc = this.docs[d];
    if (!doc) return [];
    const n = this.docs.length;
    const results: {term: string; tfidf: number}[] = [];
    for (const [term, tf] of doc) {
      const docsWithTerm = this.docs.filter(doc => (doc.get(term) ?? 0) > 0).length;
      const idf = 1 + Math.log(n / (1 + docsWithTerm));
      results.push({term, tfidf: tf * idf});
    }
    return results.sort((a, b) => b.tfidf - a.tfidf);
  }
}

function buildTfIdf(resumeText: string, job: JobInput): TfIdf {
  const index = new TfIdf();
  index.addDocument(extractTerms(resumeText));
  index.addDocument(extractTerms(`${job.title} ${job.title} ${job.description}`));
  return index;
}

function sanitizeForEmbedding(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;|&#x[\da-f]+;/gi, ' ')
    .replace(/https?:\/\/\S+|ftp:\/\/\S+/gi, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}]/gu, ' ')
    .replace(/[*_~`#>|=\-]{2,}|[*_~`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectNonEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const nonAscii = letters.filter(c => c.charCodeAt(0) > 127).length;
  return nonAscii / letters.length > NON_ENGLISH_CHAR_RATIO;
}

function computeMissingKeywordPenalty(
  settings: MissingKeywordSettings,
  jobWeights: Map<string, number>,
  resumeWeights: Map<string, number>,
  isExcluded: (term: string) => boolean,
): {missingKeywordPenalty: number; missingTerms: TermWeight[]; pinnedNotInJob: string[]} {
  if (!settings.enabled || settings.maxPenalty <= 0) {
    return {missingKeywordPenalty: 0, missingTerms: [], pinnedNotInJob: []};
  }

  const importanceRank = {low: 0, medium: 1, high: 2} as const;
  const normalizedPins = new Map<string, keyof typeof importanceRank>();
  for (const pin of settings.pinnedTerms) {
    const term = pin.term.trim().toLowerCase();
    if (!term) continue;
    const existing = normalizedPins.get(term);
    if (!existing || importanceRank[pin.importance] > importanceRank[existing]) {
      normalizedPins.set(term, pin.importance);
    }
  }

  const candidates = new Map<string, number>();
  const pinnedNotInJob: string[] = [];
  for (const [term, importance] of normalizedPins) {
    if (isExcluded(term)) continue;
    const jw = jobWeights.get(term);
    if (jw === undefined) {
      pinnedNotInJob.push(term);
      continue;
    }
    candidates.set(term, jw * PIN_IMPORTANCE_MULTIPLIERS[importance]);
  }

  let sumTotalWeight = 0;
  let sumMissingWeight = 0;
  const missing: TermWeight[] = [];
  for (const [term, weight] of candidates) {
    sumTotalWeight += weight;
    if (!resumeWeights.has(term)) {
      sumMissingWeight += weight;
      missing.push({term, weight});
    }
  }

  if (sumTotalWeight === 0) {
    return {missingKeywordPenalty: 0, missingTerms: [], pinnedNotInJob};
  }

  const coverageGap = sumMissingWeight / sumTotalWeight;
  const missingKeywordPenalty = coverageGap * settings.maxPenalty;
  const missingTerms = missing
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_MISSING_TERMS);

  return {missingKeywordPenalty, missingTerms, pinnedNotInJob};
}

async function computePreferenceMismatchPenalty(
  embedder: Embedder,
  settings: PreferenceMismatchSettings,
  jobVec: number[] | null | undefined,
): Promise<number> {
  if (!settings.enabled || settings.maxPenalty <= 0 || !jobVec) return 0;
  const prefInput = sanitizeForEmbedding(settings.text).slice(0, EMBEDDING_CHAR_CAP);
  if (!prefInput) return 0;

  const [prefVec] = await embedder.embed([prefInput]);
  if (!prefVec) return 0;

  const sim = Math.max(0, dotProduct(prefVec, jobVec));
  const gap = Math.max(0, sim - PREFERENCE_MISMATCH_FLOOR) / (1 - PREFERENCE_MISMATCH_FLOOR);
  return gap * settings.maxPenalty;
}

export async function scoreResumeAgainstJob(
  resumeText: string,
  job: JobInput,
  embedder: Embedder,
  options: ScoreOptions = {},
): Promise<MatchResult> {
  const termBoosts = options.termBoosts ?? {};
  const userStopwords = new Set(options.userStopwords ?? []);
  const missingSettings = options.missingKeyword ?? DEFAULT_MISSING_KEYWORD_SETTINGS;
  const preferenceSettings = options.preferenceMismatch ?? DEFAULT_PREFERENCE_MISMATCH_SETTINGS;

  // Build sparse TF-IDF vectors. The "corpus" is just two documents (resume + JD),
  // so IDF only distinguishes shared vs. doc-unique terms. Resume weights are scaled
  // by per-term user boosts; JD weights are raw.
  const boosts = normalizeBoosts(termBoosts);
  const tfidf = buildTfIdf(resumeText, job);

  const resumeWeights = new Map<string, number>();
  tfidf.listTerms(RESUME_INDEX).forEach((t) => {
    const boost = boosts[t.term] ?? 1;
    resumeWeights.set(t.term, t.tfidf * boost);
  });

  const jobWeights = new Map<string, number>();
  tfidf.listTerms(JOB_INDEX).forEach((t) => {
    jobWeights.set(t.term, t.tfidf);
  });

  // Top-N resume terms by weight — only these count toward matched chips and the overlap bonus.
  const sortedResume = [...resumeWeights.entries()].sort((a, b) => b[1] - a[1]);
  const topTerms = new Set(sortedResume.slice(0, TOP_TERMS_FOR_MATCHING).map(([term]) => term));

  // Cosine similarity over the sparse vectors, plus an overlap-count kicker.
  const resumeNormSq = normSq(resumeWeights);
  const jobNormSq = normSq(jobWeights);

  // Sparse dot product over shared terms; also collect matches from the resume's top slice.
  let dot = 0;
  const matched = new Set<string>();
  for (const [term, w] of resumeWeights) {
    const jw = jobWeights.get(term);
    if (jw === undefined) continue;
    dot += w * jw;
    if (topTerms.has(term)) matched.add(term);
  }

  const cosine = resumeNormSq > 0 && jobNormSq > 0
    ? dot / Math.sqrt(resumeNormSq * jobNormSq)
    : 0;
  const overlapBonus = Math.min(matched.size / OVERLAP_BONUS_THRESHOLD, 1) * OVERLAP_BONUS_MAX;
  const tfidfScore = Math.min(cosine + overlapBonus, 1);

  // Semantic similarity via the embedding model. Sanitize + truncate before embedding
  // to keep WASM memory bounded; output vectors are already unit-normalized, so the
  // dot product is the cosine.
  const resumeInput = sanitizeForEmbedding(resumeText).slice(0, EMBEDDING_CHAR_CAP);
  const jobInput = sanitizeForEmbedding(`${job.title}. ${job.description}`).slice(0, EMBEDDING_CHAR_CAP);
  const [resumeVec, jobVec] = await embedder.embed([resumeInput, jobInput]);
  const embeddingScore = resumeVec && jobVec ? Math.max(0, dotProduct(resumeVec, jobVec)) : 0;

  // Blend the two scores. When TF-IDF is near zero, the embedding is likely a false
  // positive (generic "professional text" similarity), so taper its weight down.
  // divergencePenalty is reported for the UI breakdown only.
  const tfidfSignal = Math.min(tfidfScore / DIVERGENCE_TFIDF_GATE, 1);
  const embeddingWeight = DIVERGENCE_MIN_EMBEDDING_WEIGHT + (EMBEDDING_WEIGHT - DIVERGENCE_MIN_EMBEDDING_WEIGHT) * tfidfSignal;
  const adjustedScore = Math.min(Math.max(0, embeddingWeight * embeddingScore + (1 - embeddingWeight) * tfidfScore), 1);
  const normalScore = Math.min(EMBEDDING_WEIGHT * embeddingScore + TFIDF_WEIGHT * tfidfScore, 1);
  const divergencePenalty = Math.max(0, normalScore - adjustedScore);

  const languageWarning = detectNonEnglish(job.description);

  const isExcluded = (term: string) => userStopwords.has(term) || EXTRA_STOPWORDS.has(term);

  // Top JD terms by TF-IDF weight, for the "weighted keywords" panel in the UI.
  const jobWeighted: TermWeight[] = [...jobWeights.entries()]
    .filter(([term]) => !isExcluded(term))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS_FOR_BREAKDOWN)
    .map(([term, weight]) => ({term, weight}));

  // Penalties: missing user-pinned keywords, and semantic match to the user's
  // "traits I want to avoid" text.
  const {missingKeywordPenalty, missingTerms, pinnedNotInJob} = computeMissingKeywordPenalty(
    missingSettings,
    jobWeights,
    resumeWeights,
    isExcluded,
  );

  const preferenceMismatchPenalty = await computePreferenceMismatchPenalty(
    embedder,
    preferenceSettings,
    jobVec,
  );

  const score = Math.max(0, adjustedScore - missingKeywordPenalty - preferenceMismatchPenalty);

  // Raw JD term counts for the "keyword frequency" panel — independent of TF-IDF weighting.
  const jobTokens = extractTerms(`${job.title} ${job.title} ${job.description}`, userStopwords);
  const countMap = new Map<string, number>();
  for (const t of jobTokens) {
    if (isExcluded(t)) continue;
    countMap.set(t, (countMap.get(t) ?? 0) + 1);
  }
  const jobCounts: TermCount[] = [...countMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term, count]) => ({term, count}));

  return {
    score,
    matchedTerms: [...matched].slice(0, MAX_MATCHED_TERMS),
    missingTerms,
    pinnedNotInJob,
    breakdown: {tfidfScore, embeddingScore, overlapBonus, divergencePenalty, missingKeywordPenalty, preferenceMismatchPenalty},
    jobWeighted,
    jobCounts,
    languageWarning,
  };
}
