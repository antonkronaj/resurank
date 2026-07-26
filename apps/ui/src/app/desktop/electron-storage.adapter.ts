import {Injectable} from '@angular/core';
import {
  DEFAULT_MISSING_KEYWORD_SETTINGS,
  DEFAULT_PREFERENCE_MISMATCH_SETTINGS,
  HistoryEntryInput,
  MissingKeywordSettings,
  PreferenceMismatchSettings,
  ResumeData,
  StorageAdapter,
  StoreSnapshot,
} from '../shared/storage/storage-adapter';

/**
 * The desktop build's `StorageAdapter`, verbatim from the pre-split
 * `StorageService` — same methods, same `window.electronAPI` calls, same
 * never-expiring cache (safe here: one Electron window, one process).
 * `getUserDataPath()` moved out with it; see `desktop/app.config.ts` for
 * where that call now lives.
 */
@Injectable()
export class ElectronStorageAdapter implements StorageAdapter {
  private cache: StoreSnapshot | null = null;

  async load(): Promise<StoreSnapshot> {
    if (this.cache) return this.cache;
    const snapshot = await window.electronAPI.storeRead();
    this.cache = snapshot;
    return snapshot;
  }

  async getResume(): Promise<ResumeData | null> {
    return (await this.load()).resume;
  }

  async saveResume(data: ResumeData, pdfBuffer: ArrayBuffer): Promise<void> {
    await Promise.all([
      window.electronAPI.storeWriteResume(data),
      window.electronAPI.storeSavePdf(pdfBuffer),
    ]);
    if (this.cache) this.cache.resume = data;
    else this.cache = {
      resume: data,
      stopwords: [],
      termBoosts: {},
      missingKeywordSettings: {...DEFAULT_MISSING_KEYWORD_SETTINGS},
      preferenceMismatchSettings: {...DEFAULT_PREFERENCE_MISMATCH_SETTINGS},
    };
  }

  async getStopwords(): Promise<string[]> {
    return (await this.load()).stopwords;
  }

  async saveStopwords(words: string[]): Promise<void> {
    await window.electronAPI.storeWriteStopwords(words);
    if (this.cache) this.cache.stopwords = words;
  }

  async getTermBoosts(): Promise<Record<string, number>> {
    return (await this.load()).termBoosts;
  }

  async saveTermBoosts(boosts: Record<string, number>): Promise<void> {
    await window.electronAPI.storeWriteTermBoosts(boosts);
    if (this.cache) this.cache.termBoosts = boosts;
  }

  async getMissingKeywordSettings(): Promise<MissingKeywordSettings> {
    return (await this.load()).missingKeywordSettings;
  }

  async saveMissingKeywordSettings(settings: MissingKeywordSettings): Promise<void> {
    await window.electronAPI.storeWriteMissingKeywordSettings(settings);
    if (this.cache) this.cache.missingKeywordSettings = settings;
  }

  async getPreferenceMismatchSettings(): Promise<PreferenceMismatchSettings> {
    return (await this.load()).preferenceMismatchSettings;
  }

  async savePreferenceMismatchSettings(settings: PreferenceMismatchSettings): Promise<void> {
    await window.electronAPI.storeWritePreferenceMismatchSettings(settings);
    if (this.cache) this.cache.preferenceMismatchSettings = settings;
  }

  /** Desktop has no scoring-history store — out of scope for v1. */
  async saveHistoryEntry(_entry: HistoryEntryInput): Promise<void> {
  }
}
