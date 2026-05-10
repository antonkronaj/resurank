import { Component, input, output } from '@angular/core';

export type SettingsInfoMode = 'exclusions' | 'boosts';

@Component({
  selector: 'app-settings-info-modal',
  standalone: true,
  imports: [],
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
