import natural from 'natural';
import {extractTerms, getUserStopwords} from './resumeParser.js';
import {EXTRA_STOPWORDS} from './stopwords.js';
import {embeddingClient} from './embeddingClient.js';
import {
  JOB_DESCRIPTION_CHAR_CAP,
  RESUME_CHAR_CAP,
  EMBEDDING_CHAR_CAP,
  EMBEDDING_WEIGHT,
  TFIDF_WEIGHT,
  TOP_TERMS_FOR_MATCHING,
  MAX_MATCHED_TERMS,
  TOP_TERMS_FOR_BREAKDOWN,
  OVERLAP_BONUS_THRESHOLD,
  OVERLAP_BONUS_MAX
} from '../../shared/constants.js';

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

/**
 * Strip content that inflates token count without adding semantic signal:
 * emoji sequences, URLs, Markdown syntax characters, and excess whitespace.
 * Applied before embedding so the ONNX runtime never sees token-dense garbage.
 */
function sanitizeForEmbedding(text: string): string {
  return text
    // URLs (http/https/ftp)
    .replace(/https?:\/\/\S+|ftp:\/\/\S+/gi, ' ')
    // Emoji (covers most Unicode emoji ranges including skin-tone modifiers)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}]/gu, ' ')
    // Markdown formatting: **, *, __, _, ~~, `, #, >, |, --, ==
    .replace(/[*_~`#>|=\-]{2,}|[*_~`#>|]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

async function computeEmbeddingScore(resumeText: string, job: JobInput): Promise<number> {
  const resumeInput = sanitizeForEmbedding(resumeText).slice(0, EMBEDDING_CHAR_CAP);
  const jobText = sanitizeForEmbedding(`${job.title}. ${job.description}`).slice(0, EMBEDDING_CHAR_CAP);
  const [resumeVec, jobVec] = await embeddingClient.embed([resumeInput, jobText]);
  if (!resumeVec || !jobVec) return 0;
  return Math.max(0, dotProduct(resumeVec, jobVec));
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
    .map(([term, weight]) => ({term, weight}));

  const jobTokens = extractTerms(`${job.title} ${job.title} ${job.description}`);
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
    breakdown: {tfidfScore, embeddingScore, overlapBonus},
    jobWeighted,
    jobCounts,
  };
}

