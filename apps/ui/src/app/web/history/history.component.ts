import {CommonModule} from '@angular/common';
import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {ApiService} from '../../shared/api.service';
import {EmbeddingService} from '../../shared/embedding.service';
import {scoreTier} from '../../shared/score-tier';
import {ApiHistoryEntry, ApiHistorySummary, HistoryService} from '../history.service';
import {ApiResumeSummary, ResumesService} from '../resumes.service';
import {HistoryDetailModalComponent} from './history-detail-modal.component';

type SortMode = 'newest' | 'highest';

/**
 * The History screen (web-only). "Highest score" sort is done client-side on
 * the currently loaded page — historyQuerySchema (apps/web/src/lib/
 * validation.ts) only supports ordering by date, and adding a server-side
 * score sort was out of scope for a UI-only phase.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, FormsModule, HistoryDetailModalComponent],
  templateUrl: './history.component.html',
})
export class HistoryComponent implements OnInit {
  readonly entries = signal<ApiHistorySummary[]>([]);
  readonly resumes = signal<ApiResumeSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly resumeFilter = signal<string>('');
  readonly sortMode = signal<SortMode>('newest');
  readonly selectedEntry = signal<ApiHistoryEntry | null>(null);
  readonly rescoring = signal(false);
  readonly rescoreError = signal('');
  /** Old vs new score for the entry in the open modal, once a re-score lands. */
  readonly rescoreOutcome = signal<{previous: number; next: number} | null>(null);

  /**
   * Re-scoring runs against whichever resume is active, not the one the entry
   * was originally scored with — the scoring path has no way to score against
   * an inactive resume. The modal names it so the comparison is never implied
   * to be like-for-like when it isn't.
   */
  readonly activeResumeName = computed(
    () => this.resumes().find((r) => r.isActive)?.filename ?? null,
  );

  readonly sortedEntries = computed(() => {
    const list = this.entries();
    if (this.sortMode() === 'newest') return list;
    return [...list].sort((a, b) => b.score - a.score);
  });

  readonly scoreTier = scoreTier;

  private embedding = inject(EmbeddingService);

  /**
   * True when a row was scored with a different embedding model than the one
   * loaded now, which makes its score not directly comparable to a fresh one.
   * A row with no recorded model predates provenance — unknown, not stale, so
   * it stays unmarked rather than accusing every legacy row.
   */
  scoredWithOtherModel(entry: ApiHistorySummary): boolean {
    return !!entry.embeddingModel && entry.embeddingModel !== this.embedding.modelId();
  }

  private historyService = inject(HistoryService);
  private resumesService = inject(ResumesService);
  private api = inject(ApiService);

  ngOnInit(): void {
    this.resumesService.list().then((list) => this.resumes.set(list));
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.entries.set(await this.historyService.list(this.resumeFilter() || undefined));
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  onResumeFilterChange(resumeId: string): void {
    this.resumeFilter.set(resumeId);
    this.refresh();
  }

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  async open(id: string): Promise<void> {
    try {
      this.rescoreOutcome.set(null);
      this.rescoreError.set('');
      this.selectedEntry.set(await this.historyService.get(id));
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    }
  }

  /**
   * Re-runs the stored job description through the current model and settings.
   * `ApiService.match()` writes its own history row, so this deliberately does
   * not edit the original entry — the old score stays on the record and the
   * re-score joins the list as a new row, which is what makes the two
   * comparable in the first place.
   */
  async rescore(entry: ApiHistoryEntry): Promise<void> {
    if (this.rescoring()) return;
    this.rescoring.set(true);
    this.rescoreError.set('');
    this.rescoreOutcome.set(null);
    try {
      const result = await firstValueFrom(this.api.match(entry.jobTitle, entry.jobDescription));
      this.rescoreOutcome.set({previous: entry.score, next: result.score});
      await this.refresh();
    } catch (err: unknown) {
      this.rescoreError.set(errorMessage(err));
    } finally {
      this.rescoring.set(false);
    }
  }

  closeDetail(): void {
    this.selectedEntry.set(null);
    this.rescoreOutcome.set(null);
    this.rescoreError.set('');
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
