import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../shared/config.js';

const DATA_DIR = dirname(config.databasePath);

interface ResumeData {
  filename: string;
  text: string;
  terms: string[];
  uploadedAt: string;
}

class Store {
  private resume: ResumeData | null = null;
  private stopwords: string[] = [];
  private termBoosts: Record<string, number> = {};

  private readonly paths = {
    resumePdf: join(DATA_DIR, 'resume.pdf'),
    resumeJson: join(DATA_DIR, 'resume.json'),
    stopwordsJson: join(DATA_DIR, 'stopwords.json'),
    termBoostsJson: join(DATA_DIR, 'term_boosts.json'),
  };

  constructor() {
    console.log('Initializing store with DATA_DIR:', DATA_DIR);
    console.log('Initializing store with paths:', this.paths);
    this.ensureDataDir();
    this.loadAll();
  }

  private ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadAll() {
    this.resume = this.loadJson<ResumeData>(this.paths.resumeJson);
    this.stopwords = this.loadJson<string[]>(this.paths.stopwordsJson) || [];
    this.termBoosts = this.loadJson<Record<string, number>>(this.paths.termBoostsJson) || {};
  }

  private loadJson<T>(path: string): T | null {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch (e) {
        console.error(`Failed to load ${path}:`, e);
      }
    }
    return null;
  }

  private saveJson(path: string, data: any) {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  }

  getResume() {
    return this.resume;
  }

  saveResume(filename: string, buffer: Buffer, text: string, terms: string[], uploadedAt: string) {
    this.resume = { filename, text, terms, uploadedAt };
    this.saveJson(this.paths.resumeJson, this.resume);
    writeFileSync(this.paths.resumePdf, buffer);
  }

  getStopwords() {
    return this.stopwords;
  }

  saveStopwords(words: string[]) {
    this.stopwords = words;
    this.saveJson(this.paths.stopwordsJson, this.stopwords);
  }

  getTermBoosts() {
    return this.termBoosts;
  }

  saveTermBoosts(boosts: Record<string, number>) {
    this.termBoosts = boosts;
    this.saveJson(this.paths.termBoostsJson, this.termBoosts);
  }
}

export const store = new Store();
