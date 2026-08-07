import {Component, inject} from '@angular/core';
import {RouterLink} from '@angular/router';
import {SCORING_VERSION} from '@resurank/scoring';
import {EmbeddingService} from '../../shared/embedding.service';
import {ThemeService} from '../../shared/theme.service';

/**
 * Web-only preferences + build info. Deliberately thin: the scoring knobs
 * (term boosts, exclusion words, critical keywords, preference mismatch)
 * stay in `shared/settings-drawer` next to the Score screen, because they
 * are tuned in a read-score → adjust → re-score loop that a route change
 * would break by navigating away from the pasted job description.
 *
 * What lives here instead is everything in that drawer that *wasn't* tuning:
 * the About block (hidden in the drawer on web, see its CSS) and the theme
 * preference. Reached from the avatar menu rather than the primary nav —
 * Score/Resumes/History are the core loop, and secondary destinations belong
 * beside Account.
 *
 * No app version: `APP_VERSION` resolves to `''` on web by design (nothing is
 * "installed" to version), so only the model and scoring-engine facts appear.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private themeService = inject(ThemeService);
  // Reading these three does not construct the embedder — the service builds
  // it lazily, so opening this page never triggers a model download.
  private embedding = inject(EmbeddingService);

  readonly theme = this.themeService.theme;
  readonly modelLabel = this.embedding.modelLabel;
  readonly modelDtype = this.embedding.modelDtype;
  readonly modelSizeMb = this.embedding.modelSizeMb;
  readonly scoringVersion = SCORING_VERSION;

  setTheme(theme: 'dark' | 'light'): void {
    this.theme.set(theme);
  }
}
