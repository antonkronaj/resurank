import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ApiService, MatchResult, MissingKeywordSettings, ModelStatus, PreferenceMismatchSettings, ResumeInfo,} from './api.service';
import {DEFAULT_MISSING_KEYWORD_SETTINGS, DEFAULT_PREFERENCE_MISMATCH_SETTINGS} from './storage.service';
import {DEFAULT_PIN_IMPORTANCE, EMBEDDING_WEIGHT, JOB_DESCRIPTION_CHAR_CAP, TFIDF_WEIGHT} from '@resurank/scoring/constants';
import {EmbeddingService} from './embedding.service';

import {SettingsDrawerComponent} from './settings-drawer/settings-drawer.component';
import {StopwordsModalComponent} from './stopwords-modal/stopwords-modal.component';
import {ScoreInfoModalComponent} from './score-info-modal/score-info-modal.component';
import {KeywordInfoModalComponent, KeywordInfoMode} from './keyword-info-modal/keyword-info-modal.component';

type BreakdownMode = 'weighted' | 'counts';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SettingsDrawerComponent,
    StopwordsModalComponent,
    ScoreInfoModalComponent,
    KeywordInfoModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  resume = signal<ResumeInfo>({uploaded: false});
  termBoosts = signal<Record<string, number>>({});
  stopwords = signal<string[]>([]);
  recentlyExcluded = signal<Set<string>>(new Set());
  missingSettings = signal<MissingKeywordSettings>({...DEFAULT_MISSING_KEYWORD_SETTINGS});
  pinnedSet = computed(() => new Set(this.missingSettings().pinnedTerms.map(p => p.term)));
  savingMissingSettings = signal(false);
  preferenceSettings = signal<PreferenceMismatchSettings>({...DEFAULT_PREFERENCE_MISMATCH_SETTINGS});
  savingPreferenceSettings = signal(false);
  readonly JD_CHAR_CAP = JOB_DESCRIPTION_CHAR_CAP;
  readonly EMBEDDING_WEIGHT = EMBEDDING_WEIGHT;
  readonly TFIDF_WEIGHT = TFIDF_WEIGHT;
  jdTitle = signal('');
  jdDescription = signal('');
  result = signal<MatchResult | null>(null);
  matchedTermsSet = computed(() => new Set(this.result()?.matchedTerms ?? []));
  stopwordsSet = computed(() => new Set(this.stopwords()));
  breakdownMode = signal<BreakdownMode>('weighted');
  uploading = signal(false);
  evaluating = signal(false);
  savingBoosts = signal(false);
  savingStopwords = signal(false);
  settingsOpen = signal(false);
  stopwordsOpen = signal(false);
  scoreInfoOpen = signal(false);
  keywordInfoOpen = signal(false);
  keywordInfoMode = signal<KeywordInfoMode>('weighted');
  message = signal('');
  private api = inject(ApiService);
  private embeddingService = inject(EmbeddingService);
  readonly modelStatus = computed<ModelStatus | null>(() => this.embeddingService.status());

  openKeywordInfo(mode: KeywordInfoMode): void {
    this.keywordInfoMode.set(mode);
    this.keywordInfoOpen.set(true);
  }

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.api.getResume().subscribe((r) => this.resume.set(r));
    this.api.getTermBoosts().subscribe((r) => this.termBoosts.set(r.boosts));
    this.api.getStopwords().subscribe((r) => this.stopwords.set(r.words));
    this.api.getMissingKeywordSettings().subscribe((s) => this.missingSettings.set(s));
    this.api.getPreferenceMismatchSettings().subscribe((s) => this.preferenceSettings.set(s));
  }

  onUploadResume(file: File): void {
    if (!file) return;
    this.uploading.set(true);
    this.message.set('Parsing resume…');
    this.api.uploadResume(file).subscribe({
      next: (r) => {
        this.message.set(`Resume uploaded (${r.termCount} terms).`);
        this.uploading.set(false);
        this.api.getResume().subscribe((res) => this.resume.set(res));
        this.result.set(null);
      },
      error: (err) => {
        this.message.set(`Upload failed: ${err.error?.error ?? err.message ?? err}`);
        this.uploading.set(false);
      },
    });
  }

  evaluate(): void {
    const description = this.jdDescription().trim();
    if (!description) {
      this.message.set('Paste a job description first.');
      return;
    }
    if (!this.resume().uploaded) {
      this.message.set('Upload a resume first.');
      return;
    }
    this.evaluating.set(true);
    this.message.set('Scoring…');
    this.recentlyExcluded.set(new Set());
    this.api.match(this.jdTitle().trim(), description).subscribe({
      next: (r) => {
        this.result.set(r);
        this.evaluating.set(false);
        this.message.set('');
      },
      error: (err) => {
        this.message.set(`Match failed: ${err.error?.error ?? err.message ?? err}`);
        this.evaluating.set(false);
      },
    });
  }

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  scoreTier(score: number): 'poor' | 'fair' | 'good' | 'great' {
    if (score < 0.3) return 'poor';
    if (score < 0.5) return 'fair';
    if (score < 0.7) return 'good';
    return 'great';
  }

  openStopwordsModal(): void {
    this.api.getStopwords().subscribe({
      next: (r) => {
        this.stopwords.set(r.words);
        this.stopwordsOpen.set(true);
      },
      error: (err) => this.message.set(`Failed to load exclusion words: ${err.message ?? err}`),
    });
  }

  onSaveStopwords(words: string[]): void {
    this.savingStopwords.set(true);
    this.api.saveStopwords(words).subscribe({
      next: (r) => {
        this.savingStopwords.set(false);
        this.stopwords.set(words);
        this.stopwordsOpen.set(false);
        this.message.set(`Saved ${r.count} exclusion words.`);
      },
      error: (err) => {
        this.savingStopwords.set(false);
        this.message.set(`Failed to save: ${err.error?.error ?? err.message ?? err}`);
      },
    });
  }

  onSaveTermBoosts(boosts: Record<string, number>): void {
    this.savingBoosts.set(true);
    this.api.saveTermBoosts(boosts).subscribe({
      next: () => {
        this.savingBoosts.set(false);
        this.termBoosts.set(boosts);
        this.message.set('Term boosts saved.');
      },
      error: (err) => {
        this.savingBoosts.set(false);
        this.message.set(`Failed to save boosts: ${err.error?.error ?? err.message ?? err}`);
      },
    });
  }

  setBreakdownMode(mode: BreakdownMode): void {
    this.breakdownMode.set(mode);
  }

  addToExclusion(term: string): void {
    if (this.stopwordsSet().has(term)) return;
    const updated = [...this.stopwords(), term];
    this.api.saveStopwords(updated).subscribe({
      next: () => {
        this.stopwords.set(updated);
        this.recentlyExcluded.update(s => new Set([...s, term]));
        this.message.set(`"${term}" added to exclusions.`);
      },
      error: (err) => this.message.set(`Failed to add exclusion: ${err.error?.error ?? err.message ?? err}`),
    });
  }

  undoExclusion(term: string): void {
    const updated = this.stopwords().filter(w => w !== term);
    this.api.saveStopwords(updated).subscribe({
      next: () => {
        this.stopwords.set(updated);
        this.recentlyExcluded.update(s => {
          const n = new Set(s);
          n.delete(term);
          return n;
        });
        this.message.set(`"${term}" removed from exclusions.`);
      },
      error: (err) => this.message.set(`Failed to undo exclusion: ${err.error?.error ?? err.message ?? err}`),
    });
  }

  togglePin(term: string): void {
    const normalized = term.trim().toLowerCase();
    if (!normalized) return;
    const current = this.missingSettings();
    const existing = current.pinnedTerms.find(p => p.term === normalized);
    const nextPinned = existing
      ? current.pinnedTerms.filter(p => p.term !== normalized)
      : [...current.pinnedTerms, {term: normalized, importance: DEFAULT_PIN_IMPORTANCE}];
    const next: MissingKeywordSettings = {...current, pinnedTerms: nextPinned};
    this.missingSettings.set(next);
    this.api.saveMissingKeywordSettings(next).subscribe({
      error: (err) => {
        this.missingSettings.set(current);
        this.message.set(`Failed to update pin: ${err.error?.error ?? err.message ?? err}`);
      },
    });
  }

  onSaveMissingSettings(settings: MissingKeywordSettings): void {
    this.savingMissingSettings.set(true);
    this.api.saveMissingKeywordSettings(settings).subscribe({
      next: () => {
        this.savingMissingSettings.set(false);
        this.missingSettings.set(settings);
        this.message.set('Missing-keyword settings saved.');
      },
      error: (err) => {
        this.savingMissingSettings.set(false);
        this.message.set(`Failed to save: ${err.error?.error ?? err.message ?? err}`);
      },
    });
  }

  onSavePreferenceSettings(settings: PreferenceMismatchSettings): void {
    const previous = this.preferenceSettings();
    this.savingPreferenceSettings.set(true);
    this.api.savePreferenceMismatchSettings(settings).subscribe({
      next: () => {
        this.savingPreferenceSettings.set(false);
        if (settings.text !== previous.text) {
          this.embeddingService.invalidatePreferenceCache();
        }
        this.preferenceSettings.set(settings);
        this.message.set('Preference settings saved.');
      },
      error: (err) => {
        this.savingPreferenceSettings.set(false);
        this.message.set(`Failed to save: ${err.error?.error ?? err.message ?? err}`);
      },
    });
  }
}
