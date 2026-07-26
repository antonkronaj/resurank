import {InjectionToken} from '@angular/core';

/**
 * Same-origin host + path template to fetch the embedding model from, instead
 * of the Hugging Face Hub. `undefined` by default — the desktop build never
 * overrides this, so it keeps fetching from HF exactly as before.
 *
 * The web build overrides this to a same-origin `/assets/models` mirror
 * (see scripts/fetch-model.mjs): under COEP `require-corp`, a cross-origin
 * fetch from huggingface.co has no CORP header and is blocked outright, so
 * self-hosting is not an optimization here, it's required for the app to load
 * at all in a browser.
 */
export interface ModelHostConfig {
  modelHost: string;
  remotePathTemplate: string;
}

export const MODEL_HOST = new InjectionToken<ModelHostConfig | undefined>('MODEL_HOST', {
  factory: () => undefined,
});
