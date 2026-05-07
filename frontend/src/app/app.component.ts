import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  ResumeInfo,
  MatchResult,
  ModelStatus,
} from './api.service';

import { SettingsDrawerComponent } from './settings-drawer/settings-drawer.component';
import { StopwordsModalComponent } from './stopwords-modal/stopwords-modal.component';

type BreakdownMode = 'weighted' | 'counts';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SettingsDrawerComponent,
    StopwordsModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private api = inject(ApiService);

  resume = signal<ResumeInfo>({ uploaded: false });
  termBoosts = signal<Record<string, number>>({});
  stopwords = signal<string[]>([]);

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
  message = signal('');

  modelStatus = signal<ModelStatus | null>(null);

  ngOnInit(): void {
    this.loadAll();
    this.checkModelStatus();
  }

  loadAll(): void {
    this.api.getResume().subscribe((r) => this.resume.set(r));
    this.api.getTermBoosts().subscribe((r) => this.termBoosts.set(r.boosts));
    this.api.getStopwords().subscribe((r) => this.stopwords.set(r.words));
  }

  checkModelStatus(): void {
    this.api.getHealth().subscribe({
      next: (r) => {
        this.modelStatus.set(r.model);
        if (r.model.loading) {
          setTimeout(() => this.checkModelStatus(), 2000);
        }
      },
      error: () => {
        setTimeout(() => this.checkModelStatus(), 5000);
      }
    });
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
        this.message.set(`"${term}" added to exclusions.`);
      },
      error: (err) => this.message.set(`Failed to add exclusion: ${err.error?.error ?? err.message ?? err}`),
    });
  }
}
