import { app, BrowserWindow, dialog, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { config } from '../shared/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Dev mode opt-in via env var. Packaged apps always run in prod mode.
const isDev = !app.isPackaged && process.env.JOBDASH_DEV === '1';

// process.env.DATABASE_PATH = join(app.getPath('userData'), 'jobmatch.db');

async function startBackend(): Promise<number> {
  // Resolve the compiled backend relative to this file. In dev (`tsx`) and in
  // production both map to `<repo>/backend/dist/app.js`.
  const backendUrl = pathToFileURL(join(__dirname, '..', '..', 'backend', 'dist', 'app.js'));
  // Loose typing — we don't depend on express types from inside the electron package.
  interface BackendModule {
    createApp: () => {
      listen: (port: number, host: string, cb: () => void) => import('node:http').Server;
    };
  }
  const { createApp } = (await import(backendUrl.href)) as BackendModule;

  const expressApp = createApp();

  return await new Promise<number>((resolve, reject) => {
    const server = expressApp.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (addr) resolve(addr.port);
      else reject(new Error('failed to bind backend port'));
    });
  });
}

async function createWindow(port: number): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'jobMatch',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Open external links in the system browser instead of replacing the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    // Frontend served by `ng serve` on :4200 (`npm run dev:frontend`).
    await win.loadURL(`http://localhost:4200/?apiPort=${port}`);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexFile = join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser', 'index.html');
    await win.loadFile(indexFile, { query: { apiPort: String(port) } });
  }
}

function initUpdater(): void {
  autoUpdater.logger = null; // silence to console; swap for electron-log if desired
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: 'A new version of jobMatch has been downloaded. Restart now to apply it?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[updater] check failed:', err);
  });
}

app.whenReady().then(async () => {
  const port = await startBackend();
  console.log(`[electron] backend bound to 127.0.0.1:${port}`);
  await createWindow(port);

  if (app.isPackaged) initUpdater();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
