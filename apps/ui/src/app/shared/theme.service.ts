import {Injectable, effect, signal} from '@angular/core';

/**
 * Owns theme state as a singleton so it survives independent of any one
 * component's lifecycle — on web, the toggle lives in `NavShellComponent`
 * (the persistent chrome) while the theme is applied to `AppComponent`
 * (the Score route content nested in its router-outlet, torn down and
 * recreated on navigation).
 */
@Injectable({providedIn: 'root'})
export class ThemeService {
  readonly theme = signal<'dark' | 'light'>(
    (localStorage.getItem('resurank-theme') as 'dark' | 'light') ?? 'dark'
  );

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('resurank-theme', t);
    });
  }

  toggle(): void {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }
}
