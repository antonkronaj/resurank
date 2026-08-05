import {Component, inject, input, output} from '@angular/core';
import {EmbeddingService} from '../embedding.service';
import {ModalShellComponent} from '../modal-shell/modal-shell.component';

@Component({
  selector: 'app-score-info-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './score-info-modal.component.html',
  styleUrl: './score-info-modal.component.css',
})
export class ScoreInfoModalComponent {
  isOpen = input<boolean>(false);
  close = output<void>();

  private readonly embedding = inject(EmbeddingService);
  readonly modelLabel = this.embedding.modelLabel;
  readonly modelSizeMb = this.embedding.modelSizeMb;
}
