import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-score-info-modal',
  standalone: true,
  imports: [],
  templateUrl: './score-info-modal.component.html',
  styleUrl: './score-info-modal.component.css',
})
export class ScoreInfoModalComponent {
  isOpen = input<boolean>(false);
  close = output<void>();

  onClose() {
    this.close.emit();
  }
}
