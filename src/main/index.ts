import {app, autoUpdater as squirrelUpdater, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, session, shell} from 'electron';
import {dirname, join, normalize, resolve} from 'node:path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import pkg from 'electron-updater';
import squirrelStartup from 'electron-squirrel-startup';
import {config} from '../../shared/config.js';
import * as claudeDesktop from './claude-desktop.js';

// Squirrel.Windows re-launches the app with special argv during install /
// update / uninstall so it can create shortcuts and finish housekeeping. The
// app must exit immediately when that happens; the helper returns true and
// performs the housekeeping itself.
if (squirrelStartup) {
  app.quit();
}

if (app.isPackaged) {
  process.env.DATABASE_PATH = app.getPath('userData');
}

// Register custom scheme as privileged & secure BEFORE app is ready. Loading
// the app via `app://` (instead of `file://`) gives us a secure context with
// real response headers — required for crossOriginIsolated and threaded WASM.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const {autoUpdater} = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && process.env.JOBDASH_DEV === '1';

if (isDev) {
  app.setPath('userData', resolve(config.databasePath));
}

function getDataDir(): string {
  return app.getPath('userData');
}

function ensureDataDir(): void {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'ResuRank',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  win.webContents.setWindowOpenHandler(({url}) => {
    shell.openExternal(url);
    return {action: 'deny'};
  });

  if (isDev) {
    await win.loadURL('http://localhost:4200/');
    win.webContents.openDevTools({mode: 'detach'});
  } else {
    await win.loadURL('app://localhost/index.html');
  }
}

function promptRestart(quitAndInstall: () => void): void {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update-ready'));

  dialog.showMessageBox({
    type: 'info',
    title: 'Update ready',
    message: 'A new version of ResuRank has been downloaded. Restart now to apply it?',
    buttons: ['Restart', 'Later'],
    defaultId: 0,
  }).then(({response}) => {
    if (response === 0) quitAndInstall();
  });
}

function initUpdater(): void {
  // Skip when the app is running from a mounted DMG (macOS first-run scenario).
  if (app.getPath('exe').includes('/Volumes/')) return;

  if (process.platform === 'win32') {
    // Windows ships as Squirrel.Windows (RELEASES + .nupkg). Electron's
    // built-in autoUpdater speaks that format natively; electron-updater
    // expects NSIS instead, so we use the native one here.
    squirrelUpdater.setFeedURL({
      url: 'https://github.com/antonkronaj/resurank/releases/latest/download',
    });
    squirrelUpdater.on('update-downloaded', () => {
      promptRestart(() => squirrelUpdater.quitAndInstall());
    });
    squirrelUpdater.on('error', (err) => {
      console.warn('[updater] win check failed:', err);
    });
    squirrelUpdater.checkForUpdates();
    return;
  }

  // macOS (and Linux fallback, though the Linux maker is .zip-only).
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    promptRestart(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[updater] check failed:', err);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('write-clipboard', (_event, text: string) => {
  clipboard.writeText(text);
});
ipcMain.handle('get-user-data-path', () => getDataDir());

ipcMain.handle('store-read', () => {
  const dir = getDataDir();
  type RawPin = string | {term?: unknown; importance?: unknown};
  const rawMissing = readJson<{
    enabled?: boolean;
    autoEnabled?: boolean;
    pinnedEnabled?: boolean;
    maxPenalty?: number;
    pinnedTerms?: RawPin[];
  }>(join(dir, 'missing_keyword_settings.json'));
  // Earlier shapes were `{enabled}` (single toggle) and
  // `{autoEnabled, pinnedEnabled}` (split). Both reduce to the current
  // pinned-only toggle: enable if the user previously had pinned-side
  // (or the single combined) penalty turned on. pinnedTerms used to be
  // `string[]` — promote to objects with default importance.
  const validImportance = new Set(['low', 'medium', 'high']);
  const pinnedTerms = (rawMissing?.pinnedTerms ?? []).flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry.trim() ? [{term: entry, importance: 'medium' as const}] : [];
    }
    const term = typeof entry?.term === 'string' ? entry.term : '';
    if (!term.trim()) return [];
    const importance = typeof entry?.importance === 'string' && validImportance.has(entry.importance)
      ? entry.importance as 'low' | 'medium' | 'high'
      : 'medium' as const;
    return [{term, importance}];
  });
  const missingKeywordSettings = {
    enabled: rawMissing?.pinnedEnabled ?? rawMissing?.enabled ?? false,
    maxPenalty: rawMissing?.maxPenalty ?? 0.25,
    pinnedTerms,
  };

  const rawPreference = readJson<{
    enabled?: boolean;
    maxPenalty?: number;
    text?: string;
  }>(join(dir, 'preference_mismatch_settings.json'));
  const preferenceMismatchSettings = {
    enabled: rawPreference?.enabled ?? false,
    maxPenalty: rawPreference?.maxPenalty ?? 0.25,
    text: typeof rawPreference?.text === 'string' ? rawPreference.text : '',
  };

  return {
    resume: readJson(join(dir, 'resume.json')),
    stopwords: readJson<string[]>(join(dir, 'stopwords.json')) ?? [],
    termBoosts: readJson<Record<string, number>>(join(dir, 'term_boosts.json')) ?? {},
    missingKeywordSettings,
    preferenceMismatchSettings,
  };
});

ipcMain.handle('store-write-resume', (_event, data: unknown) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'resume.json'), JSON.stringify(data, null, 2), 'utf8');
});

ipcMain.handle('store-save-pdf', (_event, buffer: ArrayBuffer) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'resume.pdf'), Buffer.from(buffer));
});

ipcMain.handle('store-write-stopwords', (_event, words: string[]) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'stopwords.json'), JSON.stringify(words, null, 2), 'utf8');
});

ipcMain.handle('store-write-term-boosts', (_event, boosts: Record<string, number>) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'term_boosts.json'), JSON.stringify(boosts, null, 2), 'utf8');
});

ipcMain.handle('store-write-missing-keyword-settings', (_event, settings: unknown) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'missing_keyword_settings.json'), JSON.stringify(settings, null, 2), 'utf8');
});

ipcMain.handle('store-write-preference-mismatch-settings', (_event, settings: unknown) => {
  ensureDataDir();
  writeFileSync(join(getDataDir(), 'preference_mismatch_settings.json'), JSON.stringify(settings, null, 2), 'utf8');
});

function readResumeText(): string | null {
  const data = readJson<{text?: unknown}>(join(getDataDir(), 'resume.json'));
  return typeof data?.text === 'string' && data.text.length > 0 ? data.text : null;
}

ipcMain.handle('claude-desktop-status', () => claudeDesktop.getStatus());
ipcMain.handle('claude-desktop-connect', () => {
  return claudeDesktop.connect({resumeText: readResumeText()});
});
ipcMain.handle('claude-desktop-disconnect', () => claudeDesktop.disconnect());
ipcMain.handle('claude-desktop-sync-resume', () => {
  const text = readResumeText();
  if (text === null) return null;
  return claudeDesktop.syncResumeFile(text);
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  const prodCsp = "default-src 'self' app:; connect-src 'self' app: https://huggingface.co https://*.huggingface.co https://*.hf.co; style-src 'self' app: 'unsafe-inline'; img-src 'self' app: data: blob:; script-src 'self' app: 'wasm-unsafe-eval' blob:; worker-src 'self' app: blob:;";
  const devCsp = "default-src 'self' http://localhost:4200; connect-src 'self' http://localhost:4200 ws://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:;";

  if (!isDev) {
    // Serve the built frontend over a privileged custom scheme so responses
    // carry real headers (COOP/COEP/CSP) and the context is secure.
    const root = join(__dirname, '..', '..', '..', 'apps', 'ui', 'dist', 'frontend', 'browser');
    protocol.handle('app', async (req) => {
      const url = new URL(req.url);
      // Strip leading slash, normalize, refuse escaping the root.
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      if (rel.startsWith('..')) return new Response('forbidden', {status: 403});
      const filePath = join(root, rel || 'index.html');
      const fileUrl = pathToFileURL(filePath).toString();
      const upstream = await net.fetch(fileUrl);
      const headers = new Headers(upstream.headers);
      headers.set('Content-Security-Policy', prodCsp);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      return new Response(upstream.body, {status: upstream.status, headers});
    });
  }

  // Dev (http://localhost:4200) still needs headers injected on the dev server's responses.
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [devCsp],
          'Cross-Origin-Opener-Policy': ['same-origin'],
          'Cross-Origin-Embedder-Policy': ['credentialless'],
        },
      });
    });
  }

  await createWindow();

  if (app.isPackaged) initUpdater();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
