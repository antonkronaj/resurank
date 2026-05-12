import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { StorageService } from './storage.service';
import { ResumeParserService, extractTerms } from './resume-parser.service';
import { EmbeddingService, ModelStatus } from './embedding.service';
import { MatcherService, MatchResult, TermWeight, TermCount, MatchBreakdown } from './matcher.service';

export type { TermWeight, TermCount, MatchBreakdown, MatchResult };

export interface ResumeInfo {
  uploaded: boolean;
  filename?: string;
  uploadedAt?: string;
  chars?: number;
}

export interface HealthResponse {
  ok: boolean;
  model: ModelStatus;
}

export type { ModelStatus };

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(
    private storage: StorageService,
    private parser: ResumeParserService,
    private embedding: EmbeddingService,
    private matcher: MatcherService,
  ) {}

  getResume(): Observable<ResumeInfo> {
    return from(this.storage.getResume().then(r => r
      ? { uploaded: true, filename: r.filename, uploadedAt: r.uploadedAt, chars: r.text.length }
      : { uploaded: false }
    ));
  }

  getHealth(): Observable<HealthResponse> {
    return new Observable(subscriber => {
      subscriber.next({ ok: true, model: this.embedding.status() });
      subscriber.complete();
    });
  }

  uploadResume(file: File): Observable<{ ok: boolean; chars: number; termCount: number }> {
    return from((async () => {
      const stopwords = new Set(await this.storage.getStopwords());
      const { text, arrayBuffer } = await this.parser.parsePdf(file);
      const terms = extractTerms(text, stopwords);
      const data = {
        filename: file.name,
        text,
        terms,
        uploadedAt: new Date().toISOString(),
      };
      await this.storage.saveResume(data, arrayBuffer);
      this.embedding.invalidateResumeCache();
      return { ok: true, chars: text.length, termCount: terms.length };
    })());
  }

  match(title: string, description: string): Observable<MatchResult> {
    return from((async () => {
      const resume = await this.storage.getResume();
      if (!resume) throw new Error('No resume uploaded');
      const boosts = await this.storage.getTermBoosts();
      const stopwords = new Set(await this.storage.getStopwords());
      return this.matcher.scoreSingleJob(resume.text, { title, description }, boosts, stopwords);
    })());
  }

  getTermBoosts(): Observable<{ boosts: Record<string, number> }> {
    return from(this.storage.getTermBoosts().then(boosts => ({ boosts })));
  }

  saveTermBoosts(boosts: Record<string, number>): Observable<{ ok: boolean }> {
    return from(this.storage.saveTermBoosts(boosts).then(() => ({ ok: true })));
  }

  getStopwords(): Observable<{ words: string[] }> {
    return from(this.storage.getStopwords().then(words => ({ words })));
  }

  saveStopwords(words: string[]): Observable<{ ok: boolean; count: number }> {
    return from(this.storage.saveStopwords(words).then(() => ({ ok: true, count: words.length })));
  }
}
