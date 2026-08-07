import {CommonModule} from '@angular/common';
import {Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {SCORING_VERSION} from '@resurank/scoring';
import {firstValueFrom} from 'rxjs';
import {ApiService} from '../../shared/api.service';
import {EmbeddingService} from '../../shared/embedding.service';
import {scoreTier} from '../../shared/score-tier';
import type {SettingsSnapshot} from '../../shared/storage/storage-adapter';
import {ApiHistoryEntry, ApiHistorySummary, HistoryService} from '../history.service';
import {ApiResumeSummary, ResumesService} from '../resumes.service';
import {HistoryDetailModalComponent} from './history-detail-modal.component';

type SortMode = 'newest' | 'highest';

/**
 * The History screen (web-only). "Highest score" sort is done client-side on
 * the currently loaded page — historyQuerySchema (apps/web/src/lib/
 * validation.ts) only supports ordering by date, and adding a server-side
 * score sort was out of scope for a UI-only phase.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, FormsModule, HistoryDetailModalComponent],
  templateUrl: './history.component.html',
})
export class HistoryComponent implements OnInit {
  readonly entries = signal<ApiHistorySummary[]>([]);
  readonly resumes = signal<ApiResumeSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly resumeFilter = signal<string>('');
  readonly sortMode = signal<SortMode>('newest');
  readonly selectedEntry = signal<ApiHistoryEntry | null>(null);
  readonly rescoring = signal(false);
  readonly rescoreError = signal('');
  /** Old vs new score for the entry in the open modal, once a re-score lands. */
  readonly rescoreOutcome = signal<{previous: number; next: number} | null>(null);
  /**
   * The settings version a re-score would run under. Null when the settings
   * loaded now have never been scored under — in which case every row really
   * did use something else, so marking them all is correct rather than noisy.
   */
  readonly currentSettingsVersionId = signal<string | null>(null);
  /**
   * The settings loaded right now, for the modal to diff a stale row against.
   * Fetched alongside `currentSettingsVersionId` in `refresh()` rather than
   * once in `ngOnInit`, so a settings edit in another tab (the reason
   * `HttpStorageAdapter` clears its cache on focus) shows up here too.
   */
  readonly currentSettings = signal<SettingsSnapshot | null>(null);

  /**
   * Re-scoring runs against whichever resume is active, not the one the entry
   * was originally scored with — the scoring path has no way to score against
   * an inactive resume. The modal names it so the comparison is never implied
   * to be like-for-like when it isn't.
   */
  readonly activeResumeName = computed(
    () => this.resumes().find((r) => r.isActive)?.filename ?? null,
  );
  /**
   * The id counterpart of `activeResumeName` — comparisons need this, not the
   * name. Two resumes can share a filename (re-uploading an edited
   * "resume.pdf" creates a new row rather than editing the old one; see
   * apps/web/src/routes/resumes.ts), so filename equality is not identity.
   */
  readonly activeResumeId = computed(() => this.resumes().find((r) => r.isActive)?.id ?? null);

  readonly sortedEntries = computed(() => {
    const list = this.entries();
    if (this.sortMode() === 'newest') return list;
    return [...list].sort((a, b) => b.score - a.score);
  });

  readonly scoreTier = scoreTier;

  private embedding = inject(EmbeddingService);

  /**
   * True when a row was scored with a different embedding model than the one
   * loaded now, which makes its score not directly comparable to a fresh one.
   * A row with no recorded model predates provenance — unknown, not stale, so
   * it stays unmarked rather than accusing every legacy row.
   */
  scoredWithOtherModel(entry: ApiHistorySummary): boolean {
    return !!entry.embeddingModel && entry.embeddingModel !== this.embedding.modelId();
  }

  /** The scoring-engine counterpart of `scoredWithOtherModel`, same null rule. */
  scoredWithOtherScoring(entry: ApiHistorySummary): boolean {
    return !!entry.scoringVersion && entry.scoringVersion !== SCORING_VERSION;
  }

  /**
   * The settings counterpart, same null rule — a row that never reported its
   * settings is unknown, not stale. Comparing version ids is equivalent to
   * comparing the settings themselves: the server only issues an id per
   * distinct settings state, so equal ids mean equal settings.
   */
  scoredWithOtherSettings(entry: ApiHistorySummary): boolean {
    return !!entry.settingsVersionId && entry.settingsVersionId !== this.currentSettingsVersionId();
  }

  /**
   * The resume counterpart, same null rule — `entry.resumeId` is null when
   * the resume it used has since been deleted, which the row already shows
   * via "Deleted resume" as its filename, so that case is left unflagged here
   * rather than doubling up. A *present* id that no longer matches the active
   * one means the account has since switched or replaced its resume — content
   * a re-score would run against is not what produced this score, exactly the
   * same "would not reproduce this number" fact the other three axes track.
   */
  scoredWithOtherResume(entry: ApiHistorySummary): boolean {
    return !!entry.resumeId && entry.resumeId !== this.activeResumeId();
  }

  /**
   * The active resume's display name for the badge title — suffixed when it
   * collides with `entry.resumeFilename`, the same disambiguation as
   * `HistoryDetailModalComponent.activeResumeLabel` and for the same reason:
   * re-uploading an edited resume keeps the filename.
   */
  activeResumeLabel(entry: ApiHistorySummary): string {
    const name = this.activeResumeName();
    if (name && name === entry.resumeFilename) return `${name} (updated)`;
    return name ?? '';
  }

  /**
   * All four axes collapsed into one badge, so a row that differs on several
   * doesn't stack chips all saying the same thing — that a re-score would not
   * reproduce this number. Null when the row is comparable, or when it predates
   * provenance entirely. The label names which axes moved; the title spells out
   * the specifics, which is what you need to judge how much it matters.
   *
   * "different" rather than "older" because none of these only ever move
   * forward: a model can be swapped back, and settings change without any
   * ordering at all.
   */
  provenanceMismatch(entry: ApiHistorySummary): {label: string; title: string} | null {
    const model = this.scoredWithOtherModel(entry);
    const engine = this.scoredWithOtherScoring(entry);
    const settings = this.scoredWithOtherSettings(entry);
    const resume = this.scoredWithOtherResume(entry);
    if (!model && !engine && !settings && !resume) return null;

    const axes = [model && 'model', engine && 'engine', settings && 'settings', resume && 'resume'].filter(Boolean);
    const then = [
      model && `model ${entry.embeddingModel}`,
      engine && `engine ${entry.scoringVersion}`,
      settings && 'different scoring settings',
      resume && `resume ${entry.resumeFilename}`,
    ].filter(Boolean).join(', ');
    const now = [
      model && `model ${this.embedding.modelId()}`,
      engine && `engine ${SCORING_VERSION}`,
      resume && `resume ${this.activeResumeLabel(entry)}`,
    ].filter(Boolean).join(', ');

    return {
      label: `different ${axes.join(' + ')}`,
      title: now
        ? `Scored with ${then}; now using ${now}.`
        : `Scored with ${then}, which have since changed.`,
    };
  }

  private historyService = inject(HistoryService);
  private resumesService = inject(ResumesService);
  private api = inject(ApiService);

  ngOnInit(): void {
    this.resumesService.list().then((list) => this.resumes.set(list));
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [{entries, currentSettingsVersionId}, stopwords, termBoosts, missingKeywordSettings, preferenceMismatchSettings] =
        await Promise.all([
          this.historyService.list(this.resumeFilter() || undefined),
          firstValueFrom(this.api.getStopwords()).then((r) => r.words),
          firstValueFrom(this.api.getTermBoosts()).then((r) => r.boosts),
          firstValueFrom(this.api.getMissingKeywordSettings()),
          firstValueFrom(this.api.getPreferenceMismatchSettings()),
        ]);
      this.entries.set(entries);
      this.currentSettingsVersionId.set(currentSettingsVersionId);
      this.currentSettings.set({
        stopwords,
        termBoosts,
        missingKeywordSettings,
        preferenceMismatchSettings,
      });
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  onResumeFilterChange(resumeId: string): void {
    this.resumeFilter.set(resumeId);
    this.refresh();
  }

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  async open(id: string): Promise<void> {
    try {
      this.rescoreOutcome.set(null);
      this.rescoreError.set('');
      this.selectedEntry.set(await this.historyService.get(id));
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    }
  }

  /**
   * Re-runs the stored job description through the current model and settings.
   * `ApiService.match()` writes its own history row, so this deliberately does
   * not edit the original entry — the old score stays on the record and the
   * re-score joins the list as a new row, which is what makes the two
   * comparable in the first place.
   */
  async rescore(entry: ApiHistoryEntry): Promise<void> {
    if (this.rescoring()) return;
    this.rescoring.set(true);
    this.rescoreError.set('');
    this.rescoreOutcome.set(null);
    try {
      const result = await firstValueFrom(this.api.match(entry.jobTitle, entry.jobDescription));
      this.rescoreOutcome.set({previous: entry.score, next: result.score});
      await this.refresh();
    } catch (err: unknown) {
      this.rescoreError.set(errorMessage(err));
    } finally {
      this.rescoring.set(false);
    }
  }

  closeDetail(): void {
    this.selectedEntry.set(null);
    this.rescoreOutcome.set(null);
    this.rescoreError.set('');
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
