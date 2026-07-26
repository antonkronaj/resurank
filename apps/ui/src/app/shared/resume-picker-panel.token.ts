import {InjectionToken, Type} from '@angular/core';

/**
 * Optional extra widget `AppComponent` renders (via `NgComponentOutlet`) next
 * to the "Job description" panel title — the "Scoring against" resume picker.
 * Desktop only ever has one resume, so there is nothing to pick; `null` by
 * default, same shape as `DESKTOP_SETTINGS_PANEL` but in the other direction.
 * Only `web/app.config.ts` provides a value, so `shared/` never needs to
 * import anything from `web/` to render it.
 */
export const RESUME_PICKER_PANEL = new InjectionToken<Type<unknown> | null>(
  'RESUME_PICKER_PANEL',
  {factory: () => null},
);
