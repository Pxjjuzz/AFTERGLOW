import { app, BrowserWindow, Menu, session } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc/registerIpc';
import {
  installMediaProtocol,
  registerMediaScheme,
  releaseAllMediaSources,
} from './files/mediaProtocol';
import { SettingsStore } from './persistence/settingsStore';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Playwright uses this to keep each run's SQLite database isolated. It has no
// effect in a normal launch.
if (process.env.AFTERGLOW_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.AFTERGLOW_USER_DATA));
}

registerMediaScheme();

// The app never autoplays on launch. This switch only ensures that the single,
// explicit ENTER THE EXPERIENCE click can start audio after the fullscreen IPC
// round-trip without Chromium rejecting the play() promise.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow: BrowserWindow | null = null;
let store: SettingsStore | null = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function isTrustedUrl(url: string): boolean {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }
  return url.startsWith('file://') && url.includes('/renderer/main_window/');
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 810,
    minWidth: 780,
    minHeight: 600,
    show: false,
    backgroundColor: '#07060B',
    title: 'AFTERGLOW',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07060B',
      symbolColor: '#A49AB8',
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  Menu.setApplicationMenu(null);
  window.setMenuBarVisibility(false);

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      console.warn('[afterglow] blocked navigation to', url);
    }
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[afterglow] renderer process ended', details.reason);
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    releaseAllMediaSources();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(__dirname, '..', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html'),
    );
  }

  return window;
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.afterglow.app');
  installMediaProtocol();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  store = new SettingsStore(path.join(app.getPath('userData'), 'afterglow.sqlite'));
  await store.init();

  mainWindow = createWindow();
  registerIpc({ getWindow: () => mainWindow, store, isPackaged: app.isPackaged });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('before-quit', () => {
  quitting = true;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  store?.close();
  store = null;
  releaseAllMediaSources();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) {
    app.quit();
  }
});

// Avoid a stray unhandled rejection leaving the immersive window in a bad state.
process.on('uncaughtException', (error) => {
  console.error('[afterglow] uncaught exception', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[afterglow] unhandled rejection', reason);
});
