import {ApplicationConfig, provideZoneChangeDetection} from '@angular/core';
import {provideHttpClient, withInterceptors} from '@angular/common/http';
import {provideRouter} from '@angular/router';
import {MODEL_HOST} from '../shared/model-host.token';
import {RESUME_PICKER_PANEL} from '../shared/resume-picker-panel.token';
import {STORAGE_ADAPTER} from '../shared/storage/storage-adapter';
import {authInterceptor} from './auth.interceptor';
import {HttpStorageAdapter} from './http-storage.adapter';
import {ResumePickerComponent} from './resume-picker/resume-picker.component';
import {webRoutes} from './routes';

/**
 * Web build's provider set. `MODEL_CACHE_DIR`, `CLIPBOARD_WRITER`,
 * `APP_VERSION` and `DESKTOP_SETTINGS_PANEL` are deliberately left at their
 * shared/ defaults (browser cache, `navigator.clipboard`, `''`, `null`) —
 * none of those concepts exist on the web, which is exactly what those
 * defaults already encode. `STORAGE_ADAPTER`, `MODEL_HOST` and
 * `RESUME_PICKER_PANEL` need a web-specific value.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(webRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Provided under its own class too (not just the STORAGE_ADAPTER token):
    // ResumePickerComponent injects the concrete HttpStorageAdapter directly
    // for setActiveResume(), which isn't part of the shared StorageAdapter
    // interface. useExisting keeps both injection paths resolving to the same
    // singleton instance, so its cache/activeResumeId state isn't split
    // across two separate objects.
    HttpStorageAdapter,
    {provide: STORAGE_ADAPTER, useExisting: HttpStorageAdapter},
    {provide: RESUME_PICKER_PANEL, useValue: ResumePickerComponent},
    {
      provide: MODEL_HOST,
      // Must be an absolute URL, not a bare path. transformers.js's tokenizer
      // existence pre-check (get_file_metadata → fetch_file_head) validates
      // remoteHost with `new URL(string)` and silently treats anything that
      // throws (a relative path has no protocol to parse) as "doesn't exist" —
      // which skips loading the tokenizer entirely instead of raising an error.
      useValue: {modelHost: `${location.origin}/assets/models/`, remotePathTemplate: '{model}/'},
    },
  ],
};
