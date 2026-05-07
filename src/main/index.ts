import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Dev mode opt-in via env var. Packaged apps always run in prod mode.
const isDev = !app.isPackaged && process.env.JOBDASH_DEV === '1';

async function startBackend(): Promise<number> {
  const backendUrl = pathToFileURL(join(__dirname, '..', '..', 'backend', 'backend', 'app.js'));
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
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  // Open external links in the system browser instead of replacing the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await win.loadURL(`http://localhost:4200/?apiPort=${port}`);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexFile = join(__dirname, '..', '..', '..', 'frontend', 'dist', 'frontend', 'browser', 'index.html');
    await win.loadFile(indexFile, { query: { apiPort: String(port) } });
  }
}

function initUpdater(): void {
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update-ready'));

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

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('write-clipboard', (_event, text: string) => { clipboard.writeText(text); });

app.whenReady().then(async () => {
  // Deny all renderer permission requests (camera, mic, notifications, etc.)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });

  // Content Security Policy for all responses including file://
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' http://localhost:4200; connect-src http://127.0.0.1:* ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self' 'unsafe-eval'"
            : "default-src 'self'; connect-src http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'",
        ],
      },
    });
  });

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
