import { Injectable } from '@angular/core';
import { EXTRA_STOPWORDS } from '@shared/stopwords';
import {
  EMBEDDING_CHAR_CAP,
  EMBEDDING_WEIGHT,
  TFIDF_WEIGHT,
  TOP_TERMS_FOR_MATCHING,
  MAX_MATCHED_TERMS,
  TOP_TERMS_FOR_BREAKDOWN,
  OVERLAP_BONUS_THRESHOLD,
  OVERLAP_BONUS_MAX,
  DIVERGENCE_TFIDF_GATE,
  DIVERGENCE_MIN_EMBEDDING_WEIGHT,
  NON_ENGLISH_CHAR_RATIO,
} from '@shared/constants';
import { extractTerms } from './resume-parser.service';
import { EmbeddingService } from './embedding.service';

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
  divergencePenalty: number;
}

export interface MatchResult {
  score: number;
  matchedTerms: string[];
  breakdown: MatchBreakdown;
  jobWeighted: TermWeight[];
  jobCounts: TermCount[];
  languageWarning: boolean;
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

class TfIdf {
  private docs: Map<string, number>[] = [];

  addDocument(terms: string[]): void {
    const freq = new Map<string, number>();
    for (const t of terms) freq.set(t, (freq.get(t) ?? 0) + 1);
    this.docs.push(freq);
  }

  listTerms(d: number): { term: string; tfidf: number }[] {
    const doc = this.docs[d];
    if (!doc) return [];
    const n = this.docs.length;
    const results: { term: string; tfidf: number }[] = [];
    for (const [term, tf] of doc) {
      const docsWithTerm = this.docs.filter(doc => (doc.get(term) ?? 0) > 0).length;
      const idf = 1 + Math.log(n / (1 + docsWithTerm));
      results.push({ term, tfidf: tf * idf });
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

@Injectable({ providedIn: 'root' })
export class MatcherService {
  constructor(private embedding: EmbeddingService) {}

  async scoreSingleJob(
    resumeText: string,
    job: JobInput,
    termBoosts: Record<string, number> = {},
    userStopwords: Set<string> = new Set(),
  ): Promise<MatchResult> {
    const boosts = normalizeBoosts(termBoosts);
    const tfidf = buildTfIdf(resumeText, job);

    const resumeWeights = new Map<string, number>();
    tfidf.listTerms(0).forEach((t: { term: string; tfidf: number }) => {
      const boost = boosts[t.term] ?? 1;
      resumeWeights.set(t.term, t.tfidf * boost);
    });

    const jobWeights = new Map<string, number>();
    tfidf.listTerms(1).forEach((t: { term: string; tfidf: number }) => {
      jobWeights.set(t.term, t.tfidf);
    });

    const sortedResume = [...resumeWeights.entries()].sort((a, b) => b[1] - a[1]);
    const topTerms = new Set(sortedResume.slice(0, TOP_TERMS_FOR_MATCHING).map(([term]) => term));

    let dot = 0, resumeNormSq = 0, jobNormSq = 0;
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

    const resumeInput = sanitizeForEmbedding(resumeText).slice(0, EMBEDDING_CHAR_CAP);
    const jobText = sanitizeForEmbedding(`${job.title}. ${job.description}`).slice(0, EMBEDDING_CHAR_CAP);
    const [resumeVec, jobVec] = await Promise.all([
      this.embedding.embedResume(resumeInput),
      this.embedding.embedJob(jobText),
    ]);
    const embeddingScore = resumeVec && jobVec ? Math.max(0, dotProduct(resumeVec, jobVec)) : 0;

    const tfidfSignal = Math.min(tfidfScore / DIVERGENCE_TFIDF_GATE, 1);
    const embeddingWeight = DIVERGENCE_MIN_EMBEDDING_WEIGHT + (EMBEDDING_WEIGHT - DIVERGENCE_MIN_EMBEDDING_WEIGHT) * tfidfSignal;
    const adjustedScore = Math.min(Math.max(0, embeddingWeight * embeddingScore + (1 - embeddingWeight) * tfidfScore), 1);
    const normalScore = Math.min(EMBEDDING_WEIGHT * embeddingScore + TFIDF_WEIGHT * tfidfScore, 1);
    const divergencePenalty = Math.max(0, normalScore - adjustedScore);
    const score = adjustedScore;

    const languageWarning = detectNonEnglish(job.description);

    const isExcluded = (term: string) => userStopwords.has(term) || EXTRA_STOPWORDS.has(term);

    const jobWeighted: TermWeight[] = [...jobWeights.entries()]
      .filter(([term]) => !isExcluded(term))
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_TERMS_FOR_BREAKDOWN)
      .map(([term, weight]) => ({ term, weight }));

    const jobTokens = extractTerms(`${job.title} ${job.title} ${job.description}`, userStopwords);
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
      breakdown: { tfidfScore, embeddingScore, overlapBonus, divergencePenalty },
      jobWeighted,
      jobCounts,
      languageWarning,
    };
  }
}
