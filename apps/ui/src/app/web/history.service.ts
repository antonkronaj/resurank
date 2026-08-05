import {HttpClient, HttpParams} from '@angular/common/http';
import {Injectable} from '@angular/core';
import type {MatchResult} from '@resurank/scoring';
import {firstValueFrom} from 'rxjs';

/** Mirrors apps/web/src/lib/domain.ts ApiHistorySummary. */
export interface ApiHistorySummary {
  id: string;
  resumeId: string | null;
  resumeFilename: string | null;
  jobTitle: string;
  score: number;
  /** Null for rows written before provenance was recorded. */
  embeddingModel: string | null;
  createdAt: string;
}

/** Mirrors apps/web/src/lib/domain.ts ApiHistoryEntry. */
export interface ApiHistoryEntry extends ApiHistorySummary {
  jobDescription: string;
  result: MatchResult;
  embeddingDtype: string | null;
  scoringVersion: string | null;
}

/**
 * Wraps /api/history. List rows deliberately omit matched/missing term
 * counts (the server's summary columns don't carry `result` at all — see
 * routes/history.ts — so a "N matched, M missing" sub-line on every row would
 * mean fetching the full MatchResult per row just to draw a list). Full
 * detail, including that breakdown, is one `get()` away per entry instead.
 */
@Injectable({providedIn: 'root'})
export class HistoryService {
  constructor(private http: HttpClient) {}

  async list(resumeId?: string): Promise<ApiHistorySummary[]> {
    const params = resumeId ? new HttpParams().set('resumeId', resumeId) : undefined;
    const res = await firstValueFrom(
      this.http.get<{history: ApiHistorySummary[]}>('/api/history', {params}),
    );
    return res.history;
  }

  async get(id: string): Promise<ApiHistoryEntry> {
    const res = await firstValueFrom(this.http.get<{entry: ApiHistoryEntry}>(`/api/history/${id}`));
    return res.entry;
  }
}
