import {CommonModule} from '@angular/common';
import {Component, inject, input, output} from '@angular/core';
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
  close = output<void>();

  readonly EMBEDDING_WEIGHT = EMBEDDING_WEIGHT;
  readonly TFIDF_WEIGHT = TFIDF_WEIGHT;
  readonly scoreTier = scoreTier;

  private readonly embedding = inject(EmbeddingService);
  readonly currentModelLabel = this.embedding.modelLabel;

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  /** Drops the org prefix, matching how the model is named everywhere else in the UI. */
  modelLabel(modelId: string): string {
    return modelId.slice(modelId.lastIndexOf('/') + 1);
  }

  scoredWithOtherModel(entry: ApiHistoryEntry): boolean {
    return !!entry.embeddingModel && entry.embeddingModel !== this.embedding.modelId();
  }
}
