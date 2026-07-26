import {Component} from '@angular/core';
import {RouterOutlet} from '@angular/router';

/**
 * The web build's bootstrap root, in place of `shared/app.component.ts`. Same
 * selector (`app-root`) so `index.html` — shared with the desktop build — is
 * untouched: whichever `main.*.ts` runs decides which component answers to
 * that tag. Its only job is hosting the router; the guarded `''` route below
 * renders the existing shared `AppComponent` unchanged.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppShellComponent {
  constructor() {
    // AppComponent normally owns `data-theme` (an effect keyed on its own
    // toggle button), but the auth screens render *before* AppComponent ever
    // does — without this, every themed CSS variable they use resolves to
    // nothing. Same key/default as AppComponent, so there's no flash or
    // mismatch when the guarded route takes over after sign-in. The auth
    // screens have no toggle of their own (matching the mockup), so a
    // one-time read is all this needs.
    const theme = (localStorage.getItem('resurank-theme') as 'dark' | 'light' | null) ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    // Phase 8: marks this as the web build so shared/ stylesheets (styles.css,
    // app.component.css) can scope viewport/overflow overrides to
    // `html[data-platform="web"]` / `:host-context([data-platform="web"])`
    // without touching the desktop build's CSS, which never sets this
    // attribute and keeps its original fixed-viewport rules untouched.
    document.documentElement.setAttribute('data-platform', 'web');
  }
}
