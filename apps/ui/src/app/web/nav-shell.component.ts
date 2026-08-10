import {Component, computed, inject, signal} from '@angular/core';
import {Router, RouterLink, RouterLinkActive, RouterOutlet} from '@angular/router';
import {AuthService} from './auth.service';
import {ThemeService} from '../shared/theme.service';

/**
 * The authenticated web app's chrome: brand, primary nav (Resumes / Score /
 * History) and an avatar menu (Account / sign out) — the "Navigation"
 * addition the plan describes, which desktop has never needed since it is a
 * single screen. Wraps the four authenticated screens as a parent route (see
 * routes.ts) rather than living inside `shared/app.component.ts`, so the
 * Score screen's own toolbar stays completely untouched.
 *
 * Also owns the min-width guard that lived in `shared/app.component.css`
 * during Phase 8: now that every authenticated screen sits behind this one
 * shell, the guard belongs here instead of duplicated per screen. Unlike
 * Phase 8's version this needs no `data-platform` gating — this component
 * only ever exists in the web bundle.
 */
@Component({
  selector: 'app-nav-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './nav-shell.component.html',
  styleUrl: './nav-shell.component.css',
})
export class NavShellComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private themeService = inject(ThemeService);

  readonly menuOpen = signal(false);
  readonly theme = this.themeService.theme;
  readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');

  readonly initials = computed(() => {
    const user = this.auth.user();
    const source = user?.name?.trim() || user?.email || '?';
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1
      ? parts[0][0] + parts[1][0]
      : source.slice(0, 2);
    return letters.toUpperCase();
  });

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  toggleTheme(): void {
    this.themeService.toggle();
    this.closeMenu();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Local sign-out only. "Sign out everywhere" deliberately lives on the
   * Account screen instead: it is irreversible (every device must re-enter
   * its password) and sat here one pixel from this button under a nearly
   * identical label, so a misclick was cheap to make and impossible to undo.
   */
  async signOut(): Promise<void> {
    this.closeMenu();
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
