import {InjectionToken, Type} from '@angular/core';

/**
 * Optional extra panel `SettingsDrawerComponent` renders via
 * `NgComponentOutlet`, for desktop-only settings (Claude Desktop integration)
 * that have no web equivalent. `null` by default; the desktop build's
 * `app.config.ts` is the only place that provides a value, so `shared/` never
 * needs to import anything from `desktop/` to render it.
 */
export const DESKTOP_SETTINGS_PANEL = new InjectionToken<Type<unknown> | null>(
  'DESKTOP_SETTINGS_PANEL',
  {factory: () => null},
);
