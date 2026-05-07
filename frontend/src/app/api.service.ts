import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface ResumeInfo {
  uploaded: boolean;
  filename?: string;
  uploadedAt?: string;
  chars?: number;
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
}

export interface MatchResult {
  score: number;
  matchedTerms: string[];
  breakdown: MatchBreakdown;
  jobWeighted: TermWeight[];
  jobCounts: TermCount[];
}

export interface ModelStatus {
  loading: boolean;
  ready: boolean;
  progress?: number;
  file?: string;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  model: ModelStatus;
}

function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const port = new URLSearchParams(window.location.search).get('apiPort');
    if (port) return `http://127.0.0.1:${port}/api`;
  }
  return 'http://localhost:3001/api';
}

const API = resolveApiBase();

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getResume(): Observable<ResumeInfo> {
    return this.http.get<ResumeInfo>(`${API}/resume`);
  }

  getHealth(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${API}/health`);
  }

  uploadResume(file: File): Observable<{ ok: boolean; chars: number; termCount: number }> {
    const fd = new FormData();
    fd.append('resume', file);
    return this.http.post<{ ok: boolean; chars: number; termCount: number }>(`${API}/resume`, fd);
  }

  match(title: string, description: string): Observable<MatchResult> {
    return this.http.post<MatchResult>(`${API}/match`, { title, description });
  }

  getTermBoosts(): Observable<{ boosts: Record<string, number> }> {
    return this.http.get<{ boosts: Record<string, number> }>(`${API}/settings/term-boosts`);
  }

  saveTermBoosts(boosts: Record<string, number>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${API}/settings/term-boosts`, { boosts });
  }

  getStopwords(): Observable<{ words: string[] }> {
    return this.http.get<{ words: string[] }>(`${API}/settings/stopwords`);
  }

  saveStopwords(words: string[]): Observable<{ ok: boolean; count: number }> {
    return this.http.put<{ ok: boolean; count: number }>(`${API}/settings/stopwords`, { words });
  }
}
