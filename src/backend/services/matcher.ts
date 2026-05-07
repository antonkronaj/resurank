import natural from 'natural';
import { extractTerms, getUserStopwords } from './resumeParser';
import { EXTRA_STOPWORDS } from './stopwords';
import { embeddingClient } from './embeddingClient';

export interface TermWeight {
  term: string;
  weight: number;
}

export interface TermCount {
  term: string;
  count: number;
}

export interface MatchBreakdown {
  tfidfScore: number;
  embeddingScore: number;
  overlapBonus: number;
}

export interface MatchResult {
  score: number;
  matchedTerms: string[];
  breakdown: MatchBreakdown;
  jobWeighted: TermWeight[];
  jobCounts: TermCount[];
}

export interface JobInput {
  title: string;
  description: string;
}

// Final score blend. Must sum to 1. Embedding captures semantic similarity
// (paraphrases, related concepts); TF-IDF anchors on shared keywords.
const EMBEDDING_WEIGHT = 0.70;
const TFIDF_WEIGHT = 0.30;

// Of the resume's TF-IDF terms sorted by weight desc, how many count as
// "high signal." Only terms in this top slice can show up as matched
// terms or contribute to the overlap bonus.
const TOP_TERMS_FOR_MATCHING = 100;

// Display cap on the matched-term chips shown in the result panel.
// Cosmetic only — doesn't affect the score.
const MAX_MATCHED_TERMS = 25;

// Display cap on the JD weighted-keywords list. The raw-counts list is
// not capped.
const TOP_TERMS_FOR_BREAKDOWN = 50;

// Overlap bonus: a small kicker added to the TF-IDF cosine. Linear from
// 0 to OVERLAP_BONUS_MAX as the match count climbs from 0 to THRESHOLD;
// flat at MAX after that. With THRESHOLD=30 and MAX=0.2, each match adds
// ~0.67% until we hit 30, then no further gain.
const OVERLAP_BONUS_THRESHOLD = 30;
const OVERLAP_BONUS_MAX = 0.2;

// Char caps before sending text to the embedding model. jina-embeddings-v2
// truncates at 8192 tokens (~32k chars in English), so we cap around there.
const RESUME_CHAR_CAP = 32000;
const JOB_DESCRIPTION_CHAR_CAP = 32000;

function dotProduct(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalizeBoosts(boosts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(boosts)) {
    if (Number.isFinite(v) && v > 0) out[k.toLowerCase()] = v;
  }
  return out;
}

function buildTfIdf(resumeText: string, job: JobInput): any {
  const TfIdf = (natural as any).TfIdf;
  const index = new TfIdf();
  index.addDocument(extractTerms(resumeText));
  // Title gets double weight by repeating it.
  index.addDocument(extractTerms(`${job.title} ${job.title} ${job.description}`));
  return index;
}

function buildResumeTermWeights(
  tfidf: any,
  boosts: Record<string, number>,
): Map<string, number> {
  const weights = new Map<string, number>();

  tfidf.listTerms(0).forEach((t: { term: string; tfidf: number }) => {
    const boost = boosts[t.term] ?? 1;
    weights.set(t.term, t.tfidf * boost);
  });

  // Inject boosted terms missing from the resume at the median baseline weight.
  const sorted = [...weights.values()].sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length / 2)] ?? 1;
  for (const [term, boost] of Object.entries(boosts)) {
    if (!weights.has(term)) weights.set(term, baseline * boost);
  }

  return weights;
}

function getJobTermWeights(tfidf: any): Map<string, number> {
  const weights = new Map<string, number>();
  tfidf.listTerms(1).forEach((t: { term: string; tfidf: number }) => {
    weights.set(t.term, t.tfidf);
  });
  return weights;
}

async function computeEmbeddingScore(resumeText: string, job: JobInput): Promise<number> {
  try {
    const resumeInput = resumeText.slice(0, RESUME_CHAR_CAP);
    const jobText = `${job.title}. ${job.description.slice(0, JOB_DESCRIPTION_CHAR_CAP)}`;
    const [resumeVec, jobVec] = await embeddingClient.embed([resumeInput, jobText]);
    if (!resumeVec || !jobVec) return 0;
    return Math.max(0, dotProduct(resumeVec, jobVec));
  } catch (err) {
    console.error('[matcher] embedding failed, falling back to TF-IDF only:', err);
    return 0;
  }
}

export async function scoreSingleJob(
  resumeText: string,
  job: JobInput,
  termBoosts: Record<string, number> = {},
): Promise<MatchResult> {
  const boosts = normalizeBoosts(termBoosts);
  const tfidf = buildTfIdf(resumeText, job);
  const resumeWeights = buildResumeTermWeights(tfidf, boosts);
  const jobWeights = getJobTermWeights(tfidf);

  const sortedResume = [...resumeWeights.entries()].sort((a, b) => b[1] - a[1]);
  const topTerms = new Set(sortedResume.slice(0, TOP_TERMS_FOR_MATCHING).map(([term]) => term));

  let dot = 0;
  let resumeNormSq = 0;
  let jobNormSq = 0;
  const matched = new Set<string>();

  for (const [term, w] of resumeWeights) {
    resumeNormSq += w * w;
    const jw = jobWeights.get(term);
    if (jw !== undefined) {
      dot += w * jw;
      if (topTerms.has(term)) matched.add(term);
    }
  }
  for (const w of jobWeights.values()) jobNormSq += w * w;

  const cosine = resumeNormSq > 0 && jobNormSq > 0
    ? dot / Math.sqrt(resumeNormSq * jobNormSq)
    : 0;
  const overlapBonus = Math.min(matched.size / OVERLAP_BONUS_THRESHOLD, 1) * OVERLAP_BONUS_MAX;
  const tfidfScore = Math.min(cosine + overlapBonus, 1);

  const embeddingScore = await computeEmbeddingScore(resumeText, job);
  const score = Math.min(EMBEDDING_WEIGHT * embeddingScore + TFIDF_WEIGHT * tfidfScore, 1);

  const userStops = getUserStopwords();
  const isExcluded = (term: string) => userStops.has(term) || EXTRA_STOPWORDS.has(term);

  const jobWeighted: TermWeight[] = [...jobWeights.entries()]
    .filter(([term]) => !isExcluded(term))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS_FOR_BREAKDOWN)
    .map(([term, weight]) => ({ term, weight }));

  const jobTokens = extractTerms(`${job.title} ${job.title} ${job.description}`);
  const countMap = new Map<string, number>();
  for (const t of jobTokens) {
    if (isExcluded(t)) continue;
    countMap.set(t, (countMap.get(t) ?? 0) + 1);
  }
  const jobCounts: TermCount[] = [...countMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term, count]) => ({ term, count }));

  return {
    score,
    matchedTerms: [...matched].slice(0, MAX_MATCHED_TERMS),
    breakdown: { tfidfScore, embeddingScore, overlapBonus },
    jobWeighted,
    jobCounts,
  };
}

