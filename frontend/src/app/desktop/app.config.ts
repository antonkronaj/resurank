import {ApplicationConfig, provideZoneChangeDetection} from '@angular/core';
import {APP_VERSION} from '../shared/app-version.token';
import {CLIPBOARD_WRITER} from '../shared/clipboard.token';
import {DESKTOP_SETTINGS_PANEL} from '../shared/desktop-settings-panel.token';
import {MODEL_CACHE_DIR} from '../shared/model-cache-dir.token';
import {STORAGE_ADAPTER} from '../shared/storage/storage-adapter';
import {ClaudeDesktopCardComponent} from './claude-desktop-card/claude-desktop-card.component';
import {ElectronStorageAdapter} from './electron-storage.adapter';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({eventCoalescing: true}),
    {provide: STORAGE_ADAPTER, useClass: ElectronStorageAdapter},
    {
      provide: MODEL_CACHE_DIR,
      useValue: () =>
        window.electronAPI.getUserDataPath().then((p) => `${p}/model-cache`).catch(() => undefined),
    },
    {provide: CLIPBOARD_WRITER, useValue: (text: string) => window.electronAPI.writeToClipboard(text)},
    {provide: APP_VERSION, useValue: () => window.electronAPI.getAppVersion()},
    {provide: DESKTOP_SETTINGS_PANEL, useValue: ClaudeDesktopCardComponent},
  ],
};
