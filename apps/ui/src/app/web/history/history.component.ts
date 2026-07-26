import {CommonModule} from '@angular/common';
import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
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

  readonly sortedEntries = computed(() => {
    const list = this.entries();
    if (this.sortMode() === 'newest') return list;
    return [...list].sort((a, b) => b.score - a.score);
  });

  readonly scoreTier = scoreTier;

  private historyService = inject(HistoryService);
  private resumesService = inject(ResumesService);

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
      this.selectedEntry.set(await this.historyService.get(id));
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    }
  }

  closeDetail(): void {
    this.selectedEntry.set(null);
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
