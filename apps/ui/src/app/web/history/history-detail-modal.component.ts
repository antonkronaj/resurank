import {CommonModule} from '@angular/common';
import {Component, computed, inject, input, output} from '@angular/core';
import {SCORING_VERSION} from '@resurank/scoring';
import {EMBEDDING_WEIGHT, TFIDF_WEIGHT} from '@resurank/scoring/constants';
import {EmbeddingService} from '../../shared/embedding.service';
import {ModalShellComponent} from '../../shared/modal-shell/modal-shell.component';
import {scoreTier} from '../../shared/score-tier';
import {diffSettings, isEmptyDiff, type SettingsDiff} from '../../shared/storage/settings-diff';
import type {SettingsSnapshot} from '../../shared/storage/storage-adapter';
import {ApiHistoryEntry} from '../history.service';

/** Full detail for one history row — job description + the stored MatchResult breakdown. */
@Component({
  selector: 'app-history-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalShellComponent],
  templateUrl: './history-detail-modal.component.html',
  styleUrl: './history-detail-modal.component.css',
})
export class HistoryDetailModalComponent {
  entry = input<ApiHistoryEntry | null>(null);
  rescoring = input<boolean>(false);
  rescoreOutcome = input<{previous: number; next: number} | null>(null);
  rescoreError = input<string>('');
  /** Null when the account has no active resume, which is what blocks re-scoring. */
  activeResumeName = input<string | null>(null);
  /** The id counterpart of `activeResumeName` — see `scoredWithOtherResume` for why identity, not the name, is what comparisons need. */
  activeResumeId = input<string | null>(null);
  /**
   * The settings version a re-score would run under, passed down from the list
   * that already fetched it. Null means the current settings have never been
   * scored under, so this entry's settings necessarily differ.
   */
  currentSettingsVersionId = input<string | null>(null);
  /** The settings loaded right now — this row's `settings` diffed against it. */
  currentSettings = input<SettingsSnapshot | null>(null);
  close = output<void>();
  rescore = output<ApiHistoryEntry>();

  readonly EMBEDDING_WEIGHT = EMBEDDING_WEIGHT;
  readonly TFIDF_WEIGHT = TFIDF_WEIGHT;
  readonly scoreTier = scoreTier;

  private readonly embedding = inject(EmbeddingService);
  readonly currentModelLabel = this.embedding.modelLabel;

  /**
   * The History screen never renders the shared AppComponent, so the global
   * model-download bar is not on this page. A first re-score here can trigger
   * the ~25 MB download, and without this the button would just sit on
   * "Scoring…" for a long time with nothing to explain it.
   */
  readonly modelProgress = computed(() => {
    const status = this.embedding.status();
    if (!status.loading || status.progress === undefined) return null;
    return Math.round(status.progress);
  });

  scorePct(score: number): number {
    return Math.round(score * 100);
  }

  /** Signed points of change, for the "73 → 68 (−5)" line after a re-score. */
  scoreDelta(outcome: {previous: number; next: number}): string {
    const delta = this.scorePct(outcome.next) - this.scorePct(outcome.previous);
    if (delta === 0) return 'no change';
    return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
  }

  /** Drops the org prefix, matching how the model is named everywhere else in the UI. */
  modelLabel(modelId: string): string {
    return modelId.slice(modelId.lastIndexOf('/') + 1);
  }

  boostCount(settings: SettingsSnapshot): number {
    return Object.keys(settings.termBoosts).length;
  }

  scoredWithOtherModel(entry: ApiHistoryEntry): boolean {
    return !!entry.embeddingModel && entry.embeddingModel !== this.embedding.modelId();
  }

  scoredWithOtherScoring(entry: ApiHistoryEntry): boolean {
    return !!entry.scoringVersion && entry.scoringVersion !== SCORING_VERSION;
  }

  scoredWithOtherSettings(entry: ApiHistoryEntry): boolean {
    return !!entry.settingsVersionId && entry.settingsVersionId !== this.currentSettingsVersionId();
  }

  /**
   * The resume counterpart, same null rule as the others — but also requires
   * an active resume to exist, unlike the model/engine/settings checks: with
   * none active there is nothing to re-score against at all (the button is
   * disabled and a separate "Upload a resume" message covers that case), so
   * this must not claim a mismatch on top of it. Compares ids rather than
   * filenames because re-uploading an edited resume under the same filename
   * creates a new row with a new id — same name, different content.
   */
  scoredWithOtherResume(entry: ApiHistoryEntry): boolean {
    const activeId = this.activeResumeId();
    return !!entry.resumeId && !!activeId && entry.resumeId !== activeId;
  }

  /**
   * The active resume's display name for provenance messages — suffixed when
   * it collides with `entry.resumeFilename`. Re-uploading an edited resume
   * keeps the same filename (a new row, not an edit — see
   * `scoredWithOtherResume`), so without this, "not the resume.pdf this entry
   * used" reads as a no-op against "your active resume, resume.pdf" even
   * though the two are different resumes.
   */
  activeResumeLabel(entry: ApiHistoryEntry): string {
    const name = this.activeResumeName();
    if (name && name === entry.resumeFilename) return `${name} (updated)`;
    return name ?? '';
  }

  /**
   * What specifically changed between this row's settings and the ones
   * loaded now, for the "different settings" case of `wouldRescoreDiffer`.
   * Null whenever there is nothing to diff: no stored settings on the row, no
   * current settings loaded yet, or (id mismatch notwithstanding) the two
   * sides turn out identical once canonicalised — which can't currently
   * happen since equal settings always resolve to the same version id, but
   * costs nothing to guard.
   */
  settingsDiff(entry: ApiHistoryEntry): SettingsDiff | null {
    const current = this.currentSettings();
    if (!entry.settings || !current) return null;
    const diff = diffSettings(entry.settings, current);
    return isEmptyDiff(diff) ? null : diff;
  }

  /** "+2 added, −1 removed" — built here rather than in the template to avoid whitespace around the comma. */
  stopwordDeltaLabel(diff: SettingsDiff): string {
    const parts: string[] = [];
    if (diff.stopwordsAdded.length) parts.push(`+${diff.stopwordsAdded.length} added`);
    if (diff.stopwordsRemoved.length) parts.push(`−${diff.stopwordsRemoved.length} removed`);
    return parts.join(', ');
  }

  /**
   * One-line version of `SettingsDiff` for the post-re-score outcome line,
   * e.g. "2 excluded words, 1 term boost, missing-keyword settings changed" —
   * the itemised list under "What changed since" is the detail view of the
   * same diff; this is the summary that fits next to a score delta.
   */
  settingsDiffSummary(diff: SettingsDiff): string {
    const parts: string[] = [];

    const stopwordDelta = diff.stopwordsAdded.length + diff.stopwordsRemoved.length;
    if (stopwordDelta) parts.push(`${stopwordDelta} excluded word${stopwordDelta === 1 ? '' : 's'}`);

    if (diff.termBoostsChanged.length) {
      const n = diff.termBoostsChanged.length;
      parts.push(`${n} term boost${n === 1 ? '' : 's'}`);
    }

    if (diff.missingKeywordEnabledChanged || diff.missingKeywordMaxPenaltyChanged) {
      parts.push('missing-keyword settings');
    }

    const pinDelta =
      diff.pinnedTermsAdded.length +
      diff.pinnedTermsRemoved.length +
      diff.pinnedTermsImportanceChanged.length;
    if (pinDelta) parts.push(`${pinDelta} pinned term${pinDelta === 1 ? '' : 's'}`);

    if (
      diff.preferenceMismatchEnabledChanged ||
      diff.preferenceMismatchMaxPenaltyChanged ||
      diff.preferenceMismatchTextChanged
    ) {
      parts.push('preference-mismatch settings');
    }

    return `${parts.join(', ')} changed`;
  }

  /**
   * Whether re-scoring would run under a different setup than produced this
   * row — any one axis is enough, since each changes the number. Drives the
   * caveat under "How this was scored".
   */
  wouldRescoreDiffer(entry: ApiHistoryEntry): boolean {
    return (
      this.scoredWithOtherModel(entry) ||
      this.scoredWithOtherScoring(entry) ||
      this.scoredWithOtherSettings(entry) ||
      this.scoredWithOtherResume(entry)
    );
  }

  /**
   * True only when every axis that could have changed is both known and
   * unchanged — a re-score would reproduce this row's score exactly, so
   * there's nothing to gain from running it again. Requires each field to be
   * present (not just non-differing) because a missing field means we can't
   * actually vouch for that axis — e.g. legacy rows recorded before ResuRank
   * tracked `embeddingModel` — and `wouldRescoreDiffer` treats "unknown" as
   * "not different", which is the wrong read here: unknown must not license
   * skipping the re-score.
   */
  rescoreWouldBeIdentical(entry: ApiHistoryEntry): boolean {
    return (
      !!entry.embeddingModel &&
      !!entry.scoringVersion &&
      !!entry.settingsVersionId &&
      !!entry.resumeId &&
      !!this.activeResumeId() &&
      !this.wouldRescoreDiffer(entry)
    );
  }

  /**
   * Names the current setup on only the axes that differ from this row, e.g.
   * "model jina-embeddings-v2-small-en and scoring engine 2.0.0". Built here
   * rather than from `@if` blocks in the template, which leak whitespace
   * around the punctuation that follows them.
   */
  currentSetupLabel(entry: ApiHistoryEntry): string {
    const parts: string[] = [];
    if (this.scoredWithOtherModel(entry)) parts.push(`model ${this.currentModelLabel()}`);
    if (this.scoredWithOtherScoring(entry)) parts.push(`scoring engine ${SCORING_VERSION}`);
    if (this.scoredWithOtherSettings(entry)) parts.push('different scoring settings');
    if (this.scoredWithOtherResume(entry)) parts.push(`resume ${this.activeResumeLabel(entry)}`);
    return parts.join(' and ');
  }
}
