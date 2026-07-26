import {InjectionToken} from '@angular/core';

/**
 * Resolves a directory for on-disk embedding-model caching, or `undefined` to
 * use the runtime's own default (Transformers.js falls back to IndexedDB in a
 * browser). Only the desktop build has a userData directory to cache into, so
 * this — not a `StorageAdapter` method — is how `EmbeddingService` (shared/)
 * learns about it without depending on anything Electron-specific.
 */
export const MODEL_CACHE_DIR = new InjectionToken<() => Promise<string | undefined>>(
  'MODEL_CACHE_DIR',
  {factory: () => () => Promise.resolve(undefined)},
);
