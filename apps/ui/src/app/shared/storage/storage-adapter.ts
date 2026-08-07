import {InjectionToken} from '@angular/core';
import type {MatchResult} from '@resurank/scoring';
import {MISSING_KEYWORD_PENALTY_DEFAULT, PREFERENCE_MISMATCH_PENALTY_DEFAULT, PinImportance} from '@resurank/scoring/constants';

export interface ResumeData {
  filename: string;
  text: string;
  terms: string[];
  uploadedAt: string;
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

export const DEFAULT_MISSING_KEYWORD_SETTINGS: MissingKeywordSettings = {
  enabled: false,
  maxPenalty: MISSING_KEYWORD_PENALTY_DEFAULT,
  pinnedTerms: [],
};

export interface PreferenceMismatchSettings {
  enabled: boolean;
  maxPenalty: number;
  text: string;
}

export const DEFAULT_PREFERENCE_MISMATCH_SETTINGS: PreferenceMismatchSettings = {
  enabled: false,
  maxPenalty: PREFERENCE_MISMATCH_PENALTY_DEFAULT,
  text: '',
};

export interface StoreSnapshot {
  resume: ResumeData | null;
  stopwords: string[];
  termBoosts: Record<string, number>;
  missingKeywordSettings: MissingKeywordSettings;
  preferenceMismatchSettings: PreferenceMismatchSettings;
}

/**
 * How a score was produced. Recorded alongside the result because a stored
 * score is only comparable to a new one when the model, its quantization and
 * the scoring weights all match — and all three move independently.
 */
export interface ScoreProvenance {
  /** Full model id, e.g. 'Xenova/jina-embeddings-v2-small-en'. */
  embeddingModel: string;
  embeddingDtype: string;
  /** @resurank/scoring version, which is what the tuning constants track. */
  scoringVersion: string;
}

/**
 * The four keys of `StoreSnapshot` that are not the resume — everything a user
 * can change that moves a score.
 */
export type SettingsSnapshot = Omit<StoreSnapshot, 'resume'>;

export interface HistoryEntryInput extends ScoreProvenance {
  jobTitle: string;
  jobDescription: string;
  result: MatchResult;
  /**
   * The settings this run scored under, captured at score time for the same
   * reason as `ScoreProvenance`: they are editable, so a stored score stops
   * being explainable the moment they change. Read back as a shared
   * `settings_versions` row rather than copied onto every history row.
   */
  settings: SettingsSnapshot;
}

/**
 * The contract `ApiService` depends on. Two implementations: `desktop/`'s
 * `ElectronStorageAdapter` (window.electronAPI, verbatim) and `web/`'s
 * `HttpStorageAdapter` (REST, added in Phase 7) — selected per build via the
 * `STORAGE_ADAPTER` token below, so `ApiService` and every UI component stay
 * unaware of which one is wired in.
 *
 * Deliberately excludes `getUserDataPath()`: that only ever built an Electron
 * model-cache directory (see `MODEL_CACHE_DIR` in ../model-cache-dir.token.ts)
 * and has no web equivalent — putting it here would force the web adapter to
 * stub a method that means nothing in a browser.
 */
export interface StorageAdapter {
  load(): Promise<StoreSnapshot>;
  getResume(): Promise<ResumeData | null>;
  saveResume(data: ResumeData, pdfBuffer: ArrayBuffer): Promise<void>;
  getStopwords(): Promise<string[]>;
  saveStopwords(words: string[]): Promise<void>;
  getTermBoosts(): Promise<Record<string, number>>;
  saveTermBoosts(boosts: Record<string, number>): Promise<void>;
  getMissingKeywordSettings(): Promise<MissingKeywordSettings>;
  saveMissingKeywordSettings(settings: MissingKeywordSettings): Promise<void>;
  getPreferenceMismatchSettings(): Promise<PreferenceMismatchSettings>;
  savePreferenceMismatchSettings(settings: PreferenceMismatchSettings): Promise<void>;
  /**
   * Persists a completed match, if this build has anywhere to put one.
   * `ElectronStorageAdapter` no-ops — desktop history is out of scope for v1 —
   * and `HttpStorageAdapter` posts to `/api/history` against whichever resume
   * is currently active. Best-effort by design: `ApiService.match()` awaits
   * this but swallows a failure, since a history-write hiccup should never
   * hide a score the user already has on screen.
   */
  saveHistoryEntry(entry: HistoryEntryInput): Promise<void>;
}

export const STORAGE_ADAPTER = new InjectionToken<StorageAdapter>('STORAGE_ADAPTER');
