import {app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, session, shell} from 'electron';
import {dirname, join, normalize, resolve} from 'node:path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import pkg from 'electron-updater';
import {config} from '../../shared/config.js';

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

function initUpdater(): void {
  if (app.getPath('exe').includes('/Volumes/')) return;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update-ready'));

    dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'A new version of ResuRank has been downloaded. Restart now to apply it?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
    }).then(({response}) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
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
  return {
    resume: readJson(join(dir, 'resume.json')),
    stopwords: readJson<string[]>(join(dir, 'stopwords.json')) ?? [],
    termBoosts: readJson<Record<string, number>>(join(dir, 'term_boosts.json')) ?? {},
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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  const prodCsp = "default-src 'self' app:; connect-src 'self' app: https://huggingface.co https://*.huggingface.co https://*.hf.co; style-src 'self' app: 'unsafe-inline'; img-src 'self' app: data: blob:; script-src 'self' app: 'wasm-unsafe-eval' blob:; worker-src 'self' app: blob:;";
  const devCsp = "default-src 'self' http://localhost:4200; connect-src 'self' http://localhost:4200 ws://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:;";

  if (!isDev) {
    // Serve the built frontend over a privileged custom scheme so responses
    // carry real headers (COOP/COEP/CSP) and the context is secure.
    const root = join(__dirname, '..', '..', '..', 'frontend', 'dist', 'frontend', 'browser');
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
