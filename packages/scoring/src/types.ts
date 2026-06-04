import type {PinImportance} from './constants.js';

export interface JobInput {
  title: string;
  description: string;
}

export interface PinnedTerm {
  term: string;
  importance: PinImportance;
}

export interface MissingKeywordSettings {
  enabled: boolean;
  maxPenalty: number;
  pinnedTerms: PinnedTerm[];
}

export interface PreferenceMismatchSettings {
  enabled: boolean;
  maxPenalty: number;
  text: string;
}

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
  missingKeywordPenalty: number;
  preferenceMismatchPenalty: number;
}

export interface MatchResult {
  score: number;
  matchedTerms: string[];
  missingTerms: TermWeight[];
  pinnedNotInJob: string[];
  breakdown: MatchBreakdown;
  jobWeighted: TermWeight[];
  jobCounts: TermCount[];
  languageWarning: boolean;
}

export interface ScoreOptions {
  termBoosts?: Record<string, number>;
  userStopwords?: Iterable<string>;
  missingKeyword?: MissingKeywordSettings;
  preferenceMismatch?: PreferenceMismatchSettings;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_MISSING_KEYWORD_SETTINGS: MissingKeywordSettings = {
  enabled: false,
  maxPenalty: 0,
  pinnedTerms: [],
};

export const DEFAULT_PREFERENCE_MISMATCH_SETTINGS: PreferenceMismatchSettings = {
  enabled: false,
  maxPenalty: 0,
  text: '',
};
