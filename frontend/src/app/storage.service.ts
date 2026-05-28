import {Injectable} from '@angular/core';
import {MISSING_KEYWORD_PENALTY_DEFAULT, PREFERENCE_MISMATCH_PENALTY_DEFAULT, PinImportance} from '@shared/constants';

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

@Injectable({providedIn: 'root'})
export class StorageService {
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

  async getUserDataPath(): Promise<string> {
    return window.electronAPI.getUserDataPath();
  }
}
