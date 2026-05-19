import {Component, input, output} from '@angular/core';
import {ModalShellComponent} from '../modal-shell/modal-shell.component';

export type SettingsInfoMode = 'exclusions' | 'boosts' | 'missing';

@Component({
  selector: 'app-settings-info-modal',
  standalone: true,
  imports: [ModalShellComponent],
  templateUrl: './settings-info-modal.component.html',
  styleUrl: './settings-info-modal.component.css',
})
export class SettingsInfoModalComponent {
  isOpen = input<boolean>(false);
  mode = input<SettingsInfoMode>('exclusions');
  close = output<void>();
}
