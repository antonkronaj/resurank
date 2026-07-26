import {InjectionToken} from '@angular/core';

/**
 * Resolves the installed app version, or `''` where the concept doesn't apply
 * — the web build has nothing "installed" to version. The desktop build
 * overrides this with `window.electronAPI.getAppVersion()`.
 */
export const APP_VERSION = new InjectionToken<() => Promise<string>>(
  'APP_VERSION',
  {factory: () => () => Promise.resolve('')},
);
