import {HttpClient, HttpParams} from '@angular/common/http';
import {Injectable} from '@angular/core';
import type {MatchResult} from '@resurank/scoring';
import {firstValueFrom} from 'rxjs';
import type {SettingsSnapshot} from '../shared/storage/storage-adapter';

/** Mirrors apps/web/src/lib/domain.ts ApiHistorySummary. */
export interface ApiHistorySummary {
  id: string;
  resumeId: string | null;
  resumeFilename: string | null;
  jobTitle: string;
  score: number;
  /** Null for rows written before provenance was recorded. */
  embeddingModel: string | null;
  /** Null for rows written before provenance was recorded. */
  scoringVersion: string | null;
  /**
   * The settings this score ran under, compared against the list's
   * `currentSettingsVersionId`. Null where the client did not report them.
   */
  settingsVersionId: string | null;
  createdAt: string;
}

/** Mirrors apps/web/src/lib/domain.ts ApiHistoryEntry. */
export interface ApiHistoryEntry extends ApiHistorySummary {
  jobDescription: string;
  result: MatchResult;
  embeddingDtype: string | null;
  /** The full settings `settingsVersionId` points at. Null exactly when it is. */
  settings: SettingsSnapshot | null;
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

  /**
   * Returns the current settings version alongside the rows, because a row is
   * only "stale settings" relative to it — and it is null when the settings
   * loaded now have never been scored under, which makes every row stale.
   */
  async list(
    resumeId?: string,
  ): Promise<{entries: ApiHistorySummary[]; currentSettingsVersionId: string | null}> {
    const params = resumeId ? new HttpParams().set('resumeId', resumeId) : undefined;
    const res = await firstValueFrom(
      this.http.get<{history: ApiHistorySummary[]; currentSettingsVersionId: string | null}>(
        '/api/history',
        {params},
      ),
    );
    return {entries: res.history, currentSettingsVersionId: res.currentSettingsVersionId};
  }

  async get(id: string): Promise<ApiHistoryEntry> {
    const res = await firstValueFrom(this.http.get<{entry: ApiHistoryEntry}>(`/api/history/${id}`));
    return res.entry;
  }
}
