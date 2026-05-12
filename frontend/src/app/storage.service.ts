import {Injectable} from '@angular/core';

export interface ResumeData {
  filename: string;
  text: string;
  terms: string[];
  uploadedAt: string;
}

export interface StoreSnapshot {
  resume: ResumeData | null;
  stopwords: string[];
  termBoosts: Record<string, number>;
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
    else this.cache = {resume: data, stopwords: [], termBoosts: {}};
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

  async getUserDataPath(): Promise<string> {
    return window.electronAPI.getUserDataPath();
  }
}
