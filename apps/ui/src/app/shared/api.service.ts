import {Inject, Injectable} from '@angular/core';
import {from, Observable} from 'rxjs';
import {
  MissingKeywordSettings,
  PreferenceMismatchSettings,
  STORAGE_ADAPTER,
  StorageAdapter,
} from './storage/storage-adapter';
import {extractTerms, ResumeParserService, stripPhoneNumbers} from './resume-parser.service';
import {EmbeddingService, ModelStatus} from './embedding.service';
import {MatchBreakdown, MatcherService, MatchResult, TermCount, TermWeight} from './matcher.service';

export type {TermWeight, TermCount, MatchBreakdown, MatchResult, MissingKeywordSettings, PreferenceMismatchSettings};

export interface ResumeInfo {
  uploaded: boolean;
  filename?: string;
  uploadedAt?: string;
  chars?: number;
}

export type {ModelStatus};

@Injectable({providedIn: 'root'})
export class ApiService {
  constructor(
    @Inject(STORAGE_ADAPTER) private storage: StorageAdapter,
    private parser: ResumeParserService,
    private embedding: EmbeddingService,
    private matcher: MatcherService,
  ) {
  }

  getResume(): Observable<ResumeInfo> {
    return from(this.storage.getResume().then(r => r
      ? {uploaded: true, filename: r.filename, uploadedAt: r.uploadedAt, chars: r.text.length}
      : {uploaded: false}
    ));
  }

  uploadResume(file: File): Observable<{ ok: boolean; chars: number; termCount: number }> {
    return from((async () => {
      const stopwords = new Set(await this.storage.getStopwords());
      const {text: rawText, arrayBuffer} = await this.parser.parsePdf(file);
      // Phone numbers are redacted before storage/scoring — never save or embed them.
      const text = stripPhoneNumbers(rawText);
      const terms = extractTerms(text, stopwords);
      const data = {
        filename: file.name,
        text,
        terms,
        uploadedAt: new Date().toISOString(),
      };
      await this.storage.saveResume(data, arrayBuffer);
      return {ok: true, chars: text.length, termCount: terms.length};
    })());
  }

  match(title: string, description: string): Observable<MatchResult> {
    return from((async () => {
      const resume = await this.storage.getResume();
      if (!resume) throw new Error('No resume uploaded');
      const boosts = await this.storage.getTermBoosts();
      // Kept as the array it arrived as, not just the Set the scorer wants:
      // the same values are recorded below as this run's settings snapshot.
      const stopwordList = await this.storage.getStopwords();
      const stopwords = new Set(stopwordList);
      const missingSettings = await this.storage.getMissingKeywordSettings();
      const preferenceSettings = await this.storage.getPreferenceMismatchSettings();
      const result = await this.matcher.scoreSingleJob(resume.text, {title, description}, boosts, stopwords, missingSettings, preferenceSettings);
      try {
        // Best-effort: the Job description's title field is optional in the
        // UI but history rows need a non-empty label, and a save failure here
        // must never hide a score the user is already looking at.
        await this.storage.saveHistoryEntry({
          jobTitle: title.trim() || 'Untitled role',
          jobDescription: description,
          result,
          // Captured after scoring, so it describes the run that produced
          // `result` rather than whatever is loaded when the row is read back.
          ...this.embedding.provenance(),
          // The exact values passed to `scoreSingleJob` above, for the same
          // reason — reading them back from storage here would race an edit
          // made while the score was in flight.
          settings: {
            stopwords: stopwordList,
            termBoosts: boosts,
            missingKeywordSettings: missingSettings,
            preferenceMismatchSettings: preferenceSettings,
          },
        });
      } catch {
        // ignored — see above
      }
      return result;
    })());
  }

  getTermBoosts(): Observable<{ boosts: Record<string, number> }> {
    return from(this.storage.getTermBoosts().then(boosts => ({boosts})));
  }

  saveTermBoosts(boosts: Record<string, number>): Observable<{ ok: boolean }> {
    return from(this.storage.saveTermBoosts(boosts).then(() => ({ok: true})));
  }

  getStopwords(): Observable<{ words: string[] }> {
    return from(this.storage.getStopwords().then(words => ({words})));
  }

  saveStopwords(words: string[]): Observable<{ ok: boolean; count: number }> {
    return from(this.storage.saveStopwords(words).then(() => ({ok: true, count: words.length})));
  }

  getMissingKeywordSettings(): Observable<MissingKeywordSettings> {
    return from(this.storage.getMissingKeywordSettings());
  }

  saveMissingKeywordSettings(settings: MissingKeywordSettings): Observable<{ ok: boolean }> {
    return from(this.storage.saveMissingKeywordSettings(settings).then(() => ({ok: true})));
  }

  getPreferenceMismatchSettings(): Observable<PreferenceMismatchSettings> {
    return from(this.storage.getPreferenceMismatchSettings());
  }

  savePreferenceMismatchSettings(settings: PreferenceMismatchSettings): Observable<{ ok: boolean }> {
    return from(this.storage.savePreferenceMismatchSettings(settings).then(() => ({ok: true})));
  }
}
