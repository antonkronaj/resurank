import { Component, input, output, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ResumeInfo } from '../api.service';
import { SettingsInfoModalComponent, SettingsInfoMode } from '../settings-info-modal/settings-info-modal.component';

interface BoostRow { term: string; weight: number; }

@Component({
  selector: 'app-settings-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, SettingsInfoModalComponent],
  templateUrl: './settings-drawer.component.html',
  styleUrl: './settings-drawer.component.css',
})
export class SettingsDrawerComponent implements OnInit {
  isOpen = input<boolean>(false);
  resume = input.required<ResumeInfo>();
  uploading = input<boolean>(false);
  termBoosts = input<Record<string, number>>({});
  savingBoosts = input<boolean>(false);

  close = output<void>();
  uploadResume = output<File>();
  saveTermBoosts = output<Record<string, number>>();
  openStopwords = output<void>();

  appVersion = signal<string>('');

  onResumeSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadResume.emit(file);
    if (input) input.value = '';
  }

  boostRows = signal<BoostRow[]>([]);

  infoOpen = signal(false);
  infoMode = signal<SettingsInfoMode>('exclusions');

  openInfo(mode: SettingsInfoMode) {
    this.infoMode.set(mode);
    this.infoOpen.set(true);
  }

  ngOnInit() {
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(version => {
        this.appVersion.set(version);
      });
    }
  }

  constructor() {
    effect(() => {
      const map = this.termBoosts();
      const rows = Object.entries(map)
        .map(([term, weight]) => ({ term, weight }))
        .sort((a, b) => b.weight - a.weight);
      this.boostRows.set(rows);
    }, { allowSignalWrites: true });
  }

  onClose() { this.close.emit(); }

  addBoostRow() {
    this.boostRows.update(rows => [...rows, { term: '', weight: 2 }]);
  }

  removeBoostRow(index: number) {
    this.boostRows.update(rows => rows.filter((_, i) => i !== index));
  }

  updateBoostTerm(index: number, term: string) {
    this.boostRows.update(rows => rows.map((r, i) => i === index ? { ...r, term } : r));
  }

  updateBoostWeight(index: number, weight: number) {
    this.boostRows.update(rows => rows.map((r, i) => i === index ? { ...r, weight } : r));
  }

  onSaveBoosts() {
    const map: Record<string, number> = {};
    for (const { term, weight } of this.boostRows()) {
      const t = term.trim().toLowerCase();
      if (t && Number.isFinite(weight) && weight > 0) map[t] = weight;
    }
    this.saveTermBoosts.emit(map);
  }

  trackByIndex(index: number) { return index; }
}
