import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {
  HistoryEntryInput,
  MissingKeywordSettings,
  PreferenceMismatchSettings,
  ResumeData,
  StorageAdapter,
  StoreSnapshot,
} from '../shared/storage/storage-adapter';

/** The subset of GET /api/bootstrap this adapter actually reads. */
interface BootstrapResponse {
  resume: (ResumeData & {id: string}) | null;
  stopwords: string[];
  termBoosts: Record<string, number>;
  missingKeywordSettings: MissingKeywordSettings;
  preferenceMismatchSettings: PreferenceMismatchSettings;
}

/**
 * REST-backed `StorageAdapter`. `load()` hits `GET /api/bootstrap` — one
 * round trip for everything, mirroring `ElectronStorageAdapter.load()`'s
 * single `storeRead()` call (see shared/storage/storage-adapter.ts) so every
 * getter here funnels through the same cached snapshot.
 *
 * Cache invalidation (finding #3 in the deployment plan): a snapshot that
 * never expires is fine on desktop — one window, one process — but wrong on
 * the web, where a second tab's writes would otherwise never be seen. This
 * adapter clears its cache whenever the window regains focus, so switching
 * back to a stale tab always re-fetches before the next read.
 */
@Injectable()
export class HttpStorageAdapter implements StorageAdapter {
  private cache: StoreSnapshot | null = null;
  private pending: Promise<StoreSnapshot> | null = null;
  private activeResumeId: string | null = null;

  constructor(private http: HttpClient) {
    window.addEventListener('focus', () => {
      this.cache = null;
    });
  }

  async load(): Promise<StoreSnapshot> {
    if (this.cache) return this.cache;
    // AppComponent's ngOnInit fires five getters back to back (resume,
    // stopwords, term boosts, missing-keyword and preference settings) before
    // any of them can resolve. Without caching the in-flight request itself,
    // each one would see `cache` still null and fire its own /api/bootstrap —
    // five round trips instead of one, on every single page load.
    if (this.pending) return this.pending;

    this.pending = firstValueFrom(this.http.get<BootstrapResponse>('/api/bootstrap'))
      .then((snapshot) => {
        this.activeResumeId = snapshot.resume?.id ?? null;
        this.cache = {
          resume: snapshot.resume,
          stopwords: snapshot.stopwords,
          termBoosts: snapshot.termBoosts,
          missingKeywordSettings: snapshot.missingKeywordSettings,
          preferenceMismatchSettings: snapshot.preferenceMismatchSettings,
        };
        return this.cache;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  async getResume(): Promise<ResumeData | null> {
    return (await this.load()).resume;
  }

  async saveResume(data: ResumeData): Promise<void> {
    // The PDF buffer never reaches the server — only extracted text does,
    // per the locked "PDF stays client-side" decision. Uploading auto-
    // activates the new resume (apps/web/src/routes/resumes.ts),
    // matching the desktop build where there was only ever one resume to be
    // active.
    const created = await firstValueFrom(
      this.http.post<{resume: ResumeData & {id: string}}>('/api/resumes', {
        filename: data.filename,
        text: data.text,
        terms: data.terms,
      }),
    );
    this.activeResumeId = created.resume.id;
    if (this.cache) this.cache.resume = data;
  }

  async getStopwords(): Promise<string[]> {
    return (await this.load()).stopwords;
  }

  async saveStopwords(words: string[]): Promise<void> {
    await firstValueFrom(this.http.patch('/api/settings', {stopwords: words}));
    if (this.cache) this.cache.stopwords = words;
  }

  async getTermBoosts(): Promise<Record<string, number>> {
    return (await this.load()).termBoosts;
  }

  async saveTermBoosts(boosts: Record<string, number>): Promise<void> {
    await firstValueFrom(this.http.patch('/api/settings', {termBoosts: boosts}));
    if (this.cache) this.cache.termBoosts = boosts;
  }

  async getMissingKeywordSettings(): Promise<MissingKeywordSettings> {
    return (await this.load()).missingKeywordSettings;
  }

  async saveMissingKeywordSettings(settings: MissingKeywordSettings): Promise<void> {
    await firstValueFrom(this.http.patch('/api/settings', {missingKeywordSettings: settings}));
    if (this.cache) this.cache.missingKeywordSettings = settings;
  }

  async getPreferenceMismatchSettings(): Promise<PreferenceMismatchSettings> {
    return (await this.load()).preferenceMismatchSettings;
  }

  async savePreferenceMismatchSettings(settings: PreferenceMismatchSettings): Promise<void> {
    await firstValueFrom(
      this.http.patch('/api/settings', {preferenceMismatchSettings: settings}),
    );
    if (this.cache) this.cache.preferenceMismatchSettings = settings;
  }

  async saveHistoryEntry(entry: HistoryEntryInput): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/history', {
        resumeId: this.activeResumeId,
        jobTitle: entry.jobTitle,
        jobDescription: entry.jobDescription,
        result: entry.result,
      }),
    );
  }

  /**
   * Called by the web-only resume-switching UI (resume-picker /
   * resumes screen) after `PUT /api/resumes/:id/active` succeeds. Not part of
   * `StorageAdapter` — multi-resume switching has no desktop equivalent — so
   * callers inject this concrete class directly rather than going through the
   * `STORAGE_ADAPTER` token. Updates the cached snapshot in place so the next
   * `getResume()` (and the next `saveHistoryEntry()`'s `activeResumeId`) sees
   * the switch immediately, without forcing a full `/api/bootstrap` refetch.
   */
  setActiveResume(resume: ResumeData & {id: string}): void {
    this.activeResumeId = resume.id;
    if (this.cache) this.cache.resume = resume;
  }
}
