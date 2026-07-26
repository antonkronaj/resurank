import {Injectable} from '@angular/core';
import {scoreResumeAgainstJob} from '@resurank/scoring';
import type {
  Embedder,
  JobInput,
  MatchBreakdown,
  MatchResult,
  TermCount,
  TermWeight,
} from '@resurank/scoring';
import {EmbeddingService} from './embedding.service';
import {DEFAULT_PREFERENCE_MISMATCH_SETTINGS, MissingKeywordSettings, PreferenceMismatchSettings} from './storage/storage-adapter';

export type {JobInput, MatchBreakdown, MatchResult, TermCount, TermWeight};

@Injectable({providedIn: 'root'})
export class MatcherService {
  private embedderAdapter: Embedder;

  constructor(private embedding: EmbeddingService) {
    this.embedderAdapter = {
      embed: (texts) => this.embedding.embed(texts),
    };
  }

  async scoreSingleJob(
    resumeText: string,
    job: JobInput,
    termBoosts: Record<string, number> = {},
    userStopwords: Set<string> = new Set(),
    missingSettings: MissingKeywordSettings = {enabled: false, maxPenalty: 0, pinnedTerms: []},
    preferenceSettings: PreferenceMismatchSettings = DEFAULT_PREFERENCE_MISMATCH_SETTINGS,
  ): Promise<MatchResult> {
    return scoreResumeAgainstJob(resumeText, job, this.embedderAdapter, {
      termBoosts,
      userStopwords,
      missingKeyword: missingSettings,
      preferenceMismatch: preferenceSettings,
    });
  }
}
