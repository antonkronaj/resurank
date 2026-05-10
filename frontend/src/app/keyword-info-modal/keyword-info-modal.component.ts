import { Component, input, output } from '@angular/core';
import { ModalShellComponent } from '../modal-shell/modal-shell.component';

export type KeywordInfoMode = 'weighted' | 'counts';

@Component({
  selector: 'app-keyword-info-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './keyword-info-modal.component.html',
  styleUrl: './keyword-info-modal.component.css',
})
export class KeywordInfoModalComponent {
  isOpen = input<boolean>(false);
  mode = input<KeywordInfoMode>('weighted');
  close = output<void>();
}
