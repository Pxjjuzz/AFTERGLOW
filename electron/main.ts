import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc/registerIpc';
import { registerAutoIpc } from './ipc/registerAutoIpc';
import {
  installMediaProtocol,
  registerMediaScheme,
  releaseAllMediaSources,
} from './files/mediaProtocol';
import { SettingsStore } from './persistence/settingsStore';
import { AutoSettingsStore } from './auto/autoSettings';
import { AutoEngine } from './auto/engine';
import { createMediaMonitor } from './media/smtcMonitor';
import { LrclibClient } from './lyrics/lrclib';
import { LyricsCache } from './lyrics/lyricsCache';
import { LyricsService } from './lyrics/service';
import type { AutoSettings, AutoStatus, OverlayPayload } from '../shared/ipc';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// The product name determines the default userData folder. Setting it before
// anything reads app.getPath('userData') keeps AfterGlowV2 isolated from the
// original AFTERGLOW installation.
app.setName('AfterGlowV2');

const testUserData = process.env.AFTERGLOWV2_USER_DATA ?? process.env.AFTERGLOW_USER_DATA;
if (testUserData) {
  app.setPath('userData', path.resolve(testUserData));
}

registerMediaScheme();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let settingsWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: SettingsStore | null = null;
let autoSettings: AutoSettingsStore | null = null;
let engine: AutoEngine | null = null;
let quitting = false;
let blockerId: number | null = null;
let lastTrayKey = '';

const startHidden =
  process.argv.includes('--hidden') || process.env.AFTERGLOWV2_START_HIDDEN === '1';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showSettings();
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

function rendererPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    devTools: !app.isPackaged,
    autoplayPolicy: 'no-user-gesture-required',
  };
}

function loadRenderer(window: BrowserWindow, mode: 'settings' | 'overlay'): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set('mode', mode);
    void window.loadURL(url.toString());
    return;
  }
  void window.loadFile(
    path.join(__dirname, '..', 'renderer', MAIN_WINDOW_VITE_NAME, 'index.html'),
    { query: { mode } },
  );
}

function guardWebContents(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      console.warn('[afterglowv2] blocked navigation to', url);
    }
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[afterglowv2] renderer process ended', details.reason);
  });
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;

  const window = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#07060B',
    title: 'AFTERGLOW V2',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07060B',
      symbolColor: '#A49AB8',
      height: 38,
    },
    webPreferences: rendererPreferences(),
  });

  Menu.setApplicationMenu(null);
  window.setMenuBarVisibility(false);
  guardWebContents(window);

  window.once('ready-to-show', () => {
    if (!startHidden) window.show();
  });

  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null;
  });

  loadRenderer(window, 'settings');
  settingsWindow = window;
  return window;
}

function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  const window = new BrowserWindow({
    show: false,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    title: 'AFTERGLOW V2',
    autoHideMenuBar: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    webPreferences: rendererPreferences(),
  });

  guardWebContents(window);

  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
    engine?.exitOverlay();
  });

  window.on('leave-full-screen', () => {
    if (quitting || !window.isVisible()) return;
    window.hide();
    engine?.exitOverlay();
  });

  window.on('closed', () => {
    if (overlayWindow === window) overlayWindow = null;
  });

  loadRenderer(window, 'overlay');
  overlayWindow = window;
  return window;
}

function startBlocker(): void {
  if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
}

function stopBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  blockerId = null;
}

function send(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) return;
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    });
    return;
  }
  window.webContents.send(channel, payload);
}

function broadcast(channel: string, payload: unknown): void {
  send(settingsWindow, channel, payload);
  send(overlayWindow, channel, payload);
}

function showOverlay(payload: OverlayPayload): void {
  const window = createOverlayWindow();
  const wasVisible = window.isVisible();
  send(window, 'auto:overlay', payload);
  if (!wasVisible) {
    window.setFullScreen(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.show();
    window.focus();
  }
  startBlocker();
}

function hideOverlayWindow(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    stopBlocker();
    return;
  }
  send(overlayWindow, 'auto:overlay', null);
  overlayWindow.hide();
  overlayWindow.setAlwaysOnTop(false);
  stopBlocker();
}

function showSettings(): void {
  const window = createSettingsWindow();
  if (window.isMinimized()) window.restore();

  // The overlay is an always-on-top fullscreen window. When the user asks for
  // settings while a scene is on screen, lift the settings window above it
  // instead of destroying the scene, then drop the always-on-top flag as soon
  // as the user moves on.
  const overlayVisible =
    overlayWindow !== null && !overlayWindow.isDestroyed() && overlayWindow.isVisible();
  if (overlayVisible) {
    window.setAlwaysOnTop(true, 'screen-saver');
    const release = () => {
      window.setAlwaysOnTop(false);
      window.removeListener('blur', release);
      window.removeListener('hide', release);
    };
    window.once('blur', release);
    window.once('hide', release);
  }

  window.show();
  window.focus();
}

function quitApp(): void {
  quitting = true;
  app.quit();
}

function uniquePlayers(status: AutoStatus | null): Array<{ id: string; label: string }> {
  if (!status) return [];
  const seen = new Map<string, string>();
  for (const session of status.sessions) {
    if (!seen.has(session.id)) {
      seen.set(session.id, session.app || session.id);
    }
  }
  return Array.from(seen, ([id, label]) => ({ id, label }));
}

function currentSettings(): AutoSettings {
  return (
    autoSettings?.get() ?? {
      enabled: true,
      monitoredPlayer: '',
      entryDelayMs: 4000,
      exitDelayMs: 8000,
      pauseDelayMs: 3000,
      pauseBehavior: 'keep',
      onlineLyrics: true,
      captureAudio: true,
      overlayControls: true,
    }
  );
}

async function setAutoSettings(patch: Partial<AutoSettings>): Promise<void> {
  if (!autoSettings) return;
  const next = await autoSettings.save(patch);
  engine?.applySettings(next);
  updateTray(engine?.getStatus() ?? null);
}

function buildTrayMenu(status: AutoStatus | null): Menu {
  const players = uniquePlayers(status);
  const settings = status?.settings ?? currentSettings();
  const playerItems: MenuItemConstructorOptions[] = [
    {
      label: 'All players',
      type: 'radio',
      checked: settings.monitoredPlayer === '',
      click: () => {
        void setAutoSettings({ monitoredPlayer: '' });
      },
    },
    ...players.map<MenuItemConstructorOptions>((player) => ({
      label: player.label,
      type: 'radio',
      checked: settings.monitoredPlayer === player.id,
      click: () => {
        void setAutoSettings({ monitoredPlayer: player.id });
      },
    })),
  ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: status?.monitoring ? 'Stop automatic mode' : 'Start automatic mode',
      click: () => {
        if (!engine) return;
        if (engine.getStatus().monitoring) {
          void setAutoSettings({ enabled: false });
        } else {
          void setAutoSettings({ enabled: true });
          engine.start();
        }
        updateTray(engine.getStatus());
      },
    },
    {
      label: 'Preview overlay',
      enabled: Boolean(status?.currentTrack && status.lyricsStatus !== 'searching'),
      click: () => {
        const result = engine?.preview();
        if (result && !result.ok) showSettings();
      },
    },
    { type: 'separator' },
    {
      label: 'Monitored player',
      submenu: playerItems,
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: () => showSettings(),
    },
    {
      label: 'Exit AfterGlowV2',
      click: () => quitApp(),
    },
  ];

  return Menu.buildFromTemplate(template);
}

function updateTray(status: AutoStatus | null): void {
  if (!tray) return;
  const key = JSON.stringify({
    monitoring: status?.monitoring ?? false,
    players: uniquePlayers(status).map((player) => player.id),
    track: status?.currentTrack?.key ?? '',
    lyrics: status?.lyricsStatus ?? '',
    player: status?.settings.monitoredPlayer ?? '',
  });
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setContextMenu(buildTrayMenu(status));
  const title = status?.currentTrack?.title;
  tray.setToolTip(
    status?.monitoring
      ? title
        ? `AfterGlowV2 — ${title}`
        : 'AfterGlowV2 — listening for playback'
      : 'AfterGlowV2 — automatic mode is off',
  );
}

function createTray(): void {
  if (tray) return;
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('AfterGlowV2');
  tray.setContextMenu(buildTrayMenu(engine?.getStatus() ?? null));
  tray.on('click', () => showSettings());
}

function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const primaryId = String(screen.getPrimaryDisplay().id);
        const primary =
          sources.find((source) => source.display_id === primaryId) ?? sources[0];
        if (!primary) {
          callback({});
          return;
        }
        callback({ video: primary, audio: 'loopback' });
      } catch (error) {
        console.error('[afterglowv2] display media handler failed', error);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

async function start(): Promise<void> {
  app.setAppUserModelId('com.pxjuzz.afterglowv2');
  installMediaProtocol();
  installDisplayMediaHandler();

  // Loopback capture is the only permission AfterGlowV2 ever needs. The
  // display-media handler above still pins the source to the primary screen,
  // and the renderer stops the video track immediately.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'display-capture');
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'display-capture',
  );

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  const userData = app.getPath('userData');
  store = new SettingsStore(path.join(userData, 'afterglow.sqlite'));
  await store.init();

  autoSettings = new AutoSettingsStore(path.join(userData, 'auto-settings.json'));
  await autoSettings.init();

  const cache = new LyricsCache(path.join(userData, 'lyrics-cache.json'));
  await cache.init();

  const monitor = createMediaMonitor(path.join(userData, 'smtc-helper.ps1'));
  const provider = new LrclibClient();
  const lyrics = new LyricsService({
    cache,
    provider,
    getOnlineEnabled: () => autoSettings?.get().onlineLyrics ?? true,
  });

  engine = new AutoEngine({
    settings: autoSettings.get(),
    monitor,
    lyrics,
    version: app.getVersion(),
    style: 'constellation',
    intensity: 1,
    reducedMotion: false,
    hooks: {
      onStatus: (status) => {
        broadcast('auto:status', status);
        updateTray(status);
      },
      onOverlay: (payload) => {
        if (payload) showOverlay(payload);
        else hideOverlayWindow();
        send(settingsWindow, 'auto:overlay', payload);
      },
      onPlayback: (update) => {
        if (overlayWindow && overlayWindow.isVisible()) {
          send(overlayWindow, 'auto:playback', update);
        }
      },
    },
  });

  registerIpc({
    getWindows: () =>
      [settingsWindow, overlayWindow].filter(
        (window): window is BrowserWindow => Boolean(window && !window.isDestroyed()),
      ),
    getSettingsWindow: () => settingsWindow,
    getOverlayWindow: () => overlayWindow,
    store,
    isPackaged: app.isPackaged,
  });

  registerAutoIpc({
    getSettingsWindow: () => settingsWindow,
    getOverlayWindow: () => overlayWindow,
    engine: () => engine,
    autoSettings: () => autoSettings,
    getAppearance: () => {
      const snapshot = store?.getSnapshot().settings;
      return {
        style: snapshot?.constellationStyle ?? 'constellation',
        intensity: snapshot?.intensity ?? 1,
        reducedMotion: snapshot?.reducedMotion === 'on',
      };
    },
    quit: quitApp,
  });

  createTray();
  createSettingsWindow();

  const settings = autoSettings.get();
  if (settings.enabled) engine.start();

  app.on('activate', () => {
    showSettings();
  });
}

app.whenReady().then(() => {
  void start().catch((error) => {
    console.error('[afterglowv2] startup failed', error);
  });
});

app.on('before-quit', () => {
  quitting = true;
  engine?.dispose();
  engine = null;
  tray?.destroy();
  tray = null;
  store?.close();
  store = null;
  releaseAllMediaSources();
  stopBlocker();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isFullScreen()) overlayWindow.setFullScreen(false);
    overlayWindow.destroy();
    overlayWindow = null;
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.destroy();
    settingsWindow = null;
  }
});

app.on('window-all-closed', () => {
  // Tray-resident: closing the settings window must not end automatic mode.
  if (quitting) app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('[afterglowv2] uncaught exception', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[afterglowv2] unhandled rejection', reason);
});
