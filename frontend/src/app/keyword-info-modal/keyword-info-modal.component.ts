import { Component, input, output } from '@angular/core';

export type KeywordInfoMode = 'weighted' | 'counts';

@Component({
  selector: 'app-keyword-info-modal',
  standalone: true,
  templateUrl: './keyword-info-modal.component.html',
  styleUrl: './keyword-info-modal.component.css',
})
export class KeywordInfoModalComponent {
  isOpen = input<boolean>(false);
  mode = input<KeywordInfoMode>('weighted');
  close = output<void>();

  onClose() {
    this.close.emit();
  }
}
