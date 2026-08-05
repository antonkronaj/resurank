import {CommonModule} from '@angular/common';
import {Component, computed, inject, input, output} from '@angular/core';
import {EMBEDDING_WEIGHT, TFIDF_WEIGHT} from '@resurank/scoring/constants';
import {EmbeddingService} from '../../shared/embedding.service';
import {ModalShellComponent} from '../../shared/modal-shell/modal-shell.component';
import {scoreTier} from '../../shared/score-tier';
import {ApiHistoryEntry} from '../history.service';

/** Full detail for one history row — job description + the stored MatchResult breakdown. */
@Component({
  selector: 'app-history-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalShellComponent],
  templateUrl: './history-detail-modal.component.html',
})
export class HistoryDetailModalComponent {
  entry = input<ApiHistoryEntry | null>(null);
  rescoring = input<boolean>(false);
  rescoreOutcome = input<{previous: number; next: number} | null>(null);
  rescoreError = input<string>('');
  /** Null when the account has no active resume, which is what blocks re-scoring. */
  activeResumeName = input<string | null>(null);
  close = output<void>();
  rescore = output<ApiHistoryEntry>();

  readonly EMBEDDING_WEIGHT = EMBEDDING_WEIGHT;
  readonly TFIDF_WEIGHT = TFIDF_WEIGHT;
  readonly scoreTier = scoreTier;

  private readonly embedding = inject(EmbeddingService);
  readonly currentModelLabel = this.embedding.modelLabel;

  /**
   * The History screen never renders the shared AppComponent, so the global
   * model-download bar is not on this page. A first re-score here can trigger
   * the ~25 MB download, and without this the button would just sit on
   * "Scoring…" for a long time with nothing to explain it.
   */
  readonly modelProgress = computed(() => {
    const status = this.embedding.status();
    if (!status.loading || status.progress === undefined) return null;
    return Math.round(status.progress);
  });

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  /** Signed points of change, for the "73 → 68 (−5)" line after a re-score. */
  scoreDelta(outcome: {previous: number; next: number}): string {
    const delta = this.scorePct(outcome.next) - this.scorePct(outcome.previous);
    if (delta === 0) return 'no change';
    return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
  }

  /** Drops the org prefix, matching how the model is named everywhere else in the UI. */
  modelLabel(modelId: string): string {
    return modelId.slice(modelId.lastIndexOf('/') + 1);
  }

  scoredWithOtherModel(entry: ApiHistoryEntry): boolean {
    return !!entry.embeddingModel && entry.embeddingModel !== this.embedding.modelId();
  }
}
