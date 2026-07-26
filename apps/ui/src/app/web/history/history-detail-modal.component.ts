import {CommonModule} from '@angular/common';
import {Component, input, output} from '@angular/core';
import {EMBEDDING_WEIGHT, TFIDF_WEIGHT} from '@resurank/scoring/constants';
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

  scorePct(score: number): number {
    return Math.round(score * 100);
  }
}
