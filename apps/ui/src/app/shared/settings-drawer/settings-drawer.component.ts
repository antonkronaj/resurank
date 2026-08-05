import {Component, effect, inject, input, OnInit, output, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {MissingKeywordSettings, PreferenceMismatchSettings, ResumeInfo} from '../api.service';
import {DEFAULT_MISSING_KEYWORD_SETTINGS, DEFAULT_PREFERENCE_MISMATCH_SETTINGS, PinnedTerm} from '../storage/storage-adapter';
import {DEFAULT_PIN_IMPORTANCE, MISSING_KEYWORD_PENALTY_LIMIT, PREFERENCE_MISMATCH_PENALTY_LIMIT, PinImportance} from '@resurank/scoring/constants';
import {SCORING_VERSION} from '@resurank/scoring';
import {SettingsInfoModalComponent, SettingsInfoMode} from '../settings-info-modal/settings-info-modal.component';
import {EmbeddingService} from '../embedding.service';
import {APP_VERSION} from '../app-version.token';
import {DESKTOP_SETTINGS_PANEL} from '../desktop-settings-panel.token';

interface BoostRow {
  term: string;
  weight: number;
}

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
  missingSettings = input<MissingKeywordSettings>({...DEFAULT_MISSING_KEYWORD_SETTINGS});
  savingMissingSettings = input<boolean>(false);
  preferenceSettings = input<PreferenceMismatchSettings>({...DEFAULT_PREFERENCE_MISMATCH_SETTINGS});
  savingPreferenceSettings = input<boolean>(false);

  close = output<void>();
  uploadResume = output<File>();
  saveTermBoosts = output<Record<string, number>>();
  saveMissingSettings = output<MissingKeywordSettings>();
  savePreferenceSettings = output<PreferenceMismatchSettings>();
  openStopwords = output<void>();

  appVersion = signal<string>('');
  boostRows = signal<BoostRow[]>([]);
  infoOpen = signal(false);
  infoMode = signal<SettingsInfoMode>('exclusions');

  missingEnabled = signal(false);
  missingMaxPenalty = signal(0);
  pinnedRows = signal<PinnedTerm[]>([]);
  readonly MISSING_PENALTY_LIMIT = MISSING_KEYWORD_PENALTY_LIMIT;
  readonly IMPORTANCE_OPTIONS: PinImportance[] = ['low', 'medium', 'high'];

  preferenceEnabled = signal(false);
  preferenceMaxPenalty = signal(0);
  preferenceText = signal('');
  readonly PREFERENCE_PENALTY_LIMIT = PREFERENCE_MISMATCH_PENALTY_LIMIT;

  private readonly embedding = inject(EmbeddingService);
  readonly modelLabel = this.embedding.modelLabel;
  readonly modelDtype = this.embedding.modelDtype;
  readonly modelSizeMb = this.embedding.modelSizeMb;
  readonly scoringVersion = SCORING_VERSION;

  /** Null on the web build — `NgComponentOutlet` in the template no-ops on null. */
  readonly desktopSettingsPanel = inject(DESKTOP_SETTINGS_PANEL);
  private readonly getAppVersion = inject(APP_VERSION);

  constructor() {
    effect(() => {
      const map = this.termBoosts();
      const rows = Object.entries(map)
        .map(([term, weight]) => ({term, weight}))
        .sort((a, b) => b.weight - a.weight);
      this.boostRows.set(rows);
    }, {allowSignalWrites: true});

    effect(() => {
      const s = this.missingSettings();
      this.missingEnabled.set(s.enabled);
      this.missingMaxPenalty.set(s.maxPenalty);
      this.pinnedRows.set(s.pinnedTerms.map(p => ({...p})));
    }, {allowSignalWrites: true});

    effect(() => {
      const s = this.preferenceSettings();
      this.preferenceEnabled.set(s.enabled);
      this.preferenceMaxPenalty.set(s.maxPenalty);
      this.preferenceText.set(s.text);
    }, {allowSignalWrites: true});
  }

  onMissingEnabledChange(enabled: boolean) {
    this.missingEnabled.set(enabled);
    this.emitMissingSettings();
  }

  onMissingMaxPenaltyChange(value: number) {
    const clamped = Math.max(0, Math.min(this.MISSING_PENALTY_LIMIT, Number(value) || 0));
    this.missingMaxPenalty.set(clamped);
  }

  onMissingMaxPenaltyCommit() {
    this.emitMissingSettings();
  }

  private emitMissingSettings() {
    this.saveMissingSettings.emit({
      enabled: this.missingEnabled(),
      maxPenalty: this.missingMaxPenalty(),
      pinnedTerms: this.missingSettings().pinnedTerms,
    });
  }

  onPreferenceEnabledChange(enabled: boolean) {
    this.preferenceEnabled.set(enabled);
    this.emitPreferenceSettings(this.preferenceSettings().text);
  }

  onPreferenceMaxPenaltyChange(value: number) {
    const clamped = Math.max(0, Math.min(this.PREFERENCE_PENALTY_LIMIT, Number(value) || 0));
    this.preferenceMaxPenalty.set(clamped);
  }

  onPreferenceMaxPenaltyCommit() {
    this.emitPreferenceSettings(this.preferenceSettings().text);
  }

  onPreferenceTextChange(text: string) {
    this.preferenceText.set(text);
  }

  onSavePreferenceText() {
    const text = this.preferenceText().trim();
    this.preferenceText.set(text);
    this.emitPreferenceSettings(text);
  }

  private emitPreferenceSettings(text: string) {
    this.savePreferenceSettings.emit({
      enabled: this.preferenceEnabled(),
      maxPenalty: this.preferenceMaxPenalty(),
      text,
    });
  }

  addPinnedRow() {
    this.pinnedRows.update(rows => [...rows, {term: '', importance: DEFAULT_PIN_IMPORTANCE}]);
  }

  removePinnedRow(index: number) {
    this.pinnedRows.update(rows => rows.filter((_, i) => i !== index));
  }

  updatePinnedTerm(index: number, term: string) {
    this.pinnedRows.update(rows => rows.map((r, i) => i === index ? {...r, term} : r));
  }

  updatePinnedImportance(index: number, importance: PinImportance) {
    this.pinnedRows.update(rows => rows.map((r, i) => i === index ? {...r, importance} : r));
  }

  onSavePinned() {
    const seen = new Set<string>();
    const cleaned: PinnedTerm[] = [];
    for (const row of this.pinnedRows()) {
      const t = row.term.trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      cleaned.push({term: t, importance: row.importance});
    }
    this.pinnedRows.set(cleaned);
    this.saveMissingSettings.emit({
      enabled: this.missingEnabled(),
      maxPenalty: this.missingMaxPenalty(),
      pinnedTerms: cleaned,
    });
  }

  onResumeSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadResume.emit(file);
    if (input) input.value = '';
  }

  openInfo(mode: SettingsInfoMode) {
    this.infoMode.set(mode);
    this.infoOpen.set(true);
  }

  ngOnInit() {
    this.getAppVersion().then(version => this.appVersion.set(version));
  }

  onClose() {
    this.close.emit();
  }

  addBoostRow() {
    this.boostRows.update(rows => [...rows, {term: '', weight: 2}]);
  }

  removeBoostRow(index: number) {
    this.boostRows.update(rows => rows.filter((_, i) => i !== index));
  }

  updateBoostTerm(index: number, term: string) {
    this.boostRows.update(rows => rows.map((r, i) => i === index ? {...r, term} : r));
  }

  updateBoostWeight(index: number, weight: number) {
    this.boostRows.update(rows => rows.map((r, i) => i === index ? {...r, weight} : r));
  }

  onSaveBoosts() {
    const map: Record<string, number> = {};
    for (const {term, weight} of this.boostRows()) {
      const t = term.trim().toLowerCase();
      if (t && Number.isFinite(weight) && weight > 0) map[t] = weight;
    }
    this.saveTermBoosts.emit(map);
  }

  trackByIndex(index: number) {
    return index;
  }
}
