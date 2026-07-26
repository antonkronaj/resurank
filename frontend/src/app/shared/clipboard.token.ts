import {InjectionToken} from '@angular/core';

/**
 * Writes text to the system clipboard. Defaults to the browser API for the
 * web build. The desktop build overrides this to route through the main
 * process (`window.electronAPI.writeToClipboard`) instead of calling
 * `navigator.clipboard` directly — the renderer denies all permission
 * prompts (see CLAUDE.md), and the main-process path is what avoids one.
 */
export const CLIPBOARD_WRITER = new InjectionToken<(text: string) => Promise<void>>(
  'CLIPBOARD_WRITER',
  {factory: () => (text: string) => navigator.clipboard.writeText(text)},
);
