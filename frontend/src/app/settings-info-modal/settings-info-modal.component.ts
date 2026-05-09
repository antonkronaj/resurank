import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type SettingsInfoMode = 'exclusions' | 'boosts';

@Component({
  selector: 'app-settings-info-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-info-modal.component.html',
  styleUrl: './settings-info-modal.component.css',
})
export class SettingsInfoModalComponent {
  isOpen = input<boolean>(false);
  mode = input<SettingsInfoMode>('exclusions');
  close = output<void>();

  onClose() {
    this.close.emit();
  }
}
