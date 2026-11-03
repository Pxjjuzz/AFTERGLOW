import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerSaveBlocker,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  isFileKind,
  type ExitRequest,
  type FileKind,
  type FullscreenState,
  type SelectedFile,
} from '../../shared/ipc';
import { createMediaSource, releaseMediaSource } from '../files/mediaProtocol';
import { readLyricFile, validateSelectedPath } from '../files/validation';
import { sanitizeSettingsPatch, type SettingsStore } from '../persistence/settingsStore';

interface IpcContext {
  getWindow: () => BrowserWindow | null;
  store: SettingsStore;
  isPackaged: boolean;
}

const DIALOG_FILTERS: Record<FileKind, Electron.FileFilter[]> = {
  audio: [
    {
      name: 'Audio',
      extensions: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'webm'],
    },
  ],
  lyrics: [{ name: 'LRC lyrics', extensions: ['lrc'] }],
};

function waitForEvent(target: BrowserWindow, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const emitter = target as unknown as NodeJS.EventEmitter;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      emitter.removeListener(event, listener);
      resolve(value);
    };
    const listener = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    emitter.once(event, listener);
  });
}

export function registerIpc(context: IpcContext): void {
  const { getWindow, store, isPackaged } = context;
  let blockerId: number | null = null;
  let programmaticExit = false;

  const senderWindow = (
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  ): BrowserWindow | null => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return null;
    if (event.sender !== window.webContents) return null;
    if (event.senderFrame && event.senderFrame !== window.webContents.mainFrame) return null;
    return window;
  };

  const assertTrusted = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = senderWindow(event);
    if (!window) throw new Error('Rejected IPC from an untrusted sender.');
    return window;
  };

  const startBlocker = () => {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
  };

  const stopBlocker = () => {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
  };

  const sendExitRequest = (reason: ExitRequest['reason']) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('experience:exit-requested', { reason });
    }
  };

  ipcMain.handle('app:get-version', (event) => {
    assertTrusted(event);
    return app.getVersion();
  });

  ipcMain.handle('files:pick', async (event, rawKind: unknown) => {
    const window = assertTrusted(event);
    if (!isFileKind(rawKind)) throw new Error('Invalid file kind.');
    const kind = rawKind;

    try {
      const result = await dialog.showOpenDialog(window, {
        title: kind === 'audio' ? 'Choose an audio file' : 'Choose its LRC lyrics',
        properties: ['openFile'],
        filters: DIALOG_FILTERS[kind],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const, canceled: true as const };
      }
      return await validateSelectedPath(result.filePaths[0], kind);
    } catch (error) {
      console.error('[afterglow] file dialog failed', error);
      return {
        ok: false as const,
        error: {
          code: 'DIALOG_ERROR' as const,
          message: 'The file picker could not be opened. Try dragging the file in instead.',
        },
      };
    }
  });

  ipcMain.handle('files:validate', async (event, rawKind: unknown, rawPath: unknown) => {
    assertTrusted(event);
    if (!isFileKind(rawKind)) {
      return {
        ok: false,
        error: { code: 'INVALID_PATH', message: 'Invalid file kind.' },
      };
    }
    return validateSelectedPath(rawPath, rawKind);
  });

  ipcMain.handle('files:read-lyrics', async (event, rawPath: unknown) => {
    assertTrusted(event);
    return readLyricFile(rawPath);
  });

  ipcMain.handle('media:prepare', async (event, rawPath: unknown) => {
    assertTrusted(event);
    return createMediaSource(rawPath);
  });

  ipcMain.handle('media:release', (event, token: unknown) => {
    assertTrusted(event);
    if (typeof token === 'string' && token.length <= 128) {
      releaseMediaSource(token);
    }
  });

  ipcMain.handle('experience:enter', async (event) => {
    const window = assertTrusted(event);
    if (window.isFullScreen()) {
      startBlocker();
      return { ok: true, fullscreen: true };
    }

    programmaticExit = false;
    window.setFullScreen(true);
    const entered = await waitForEvent(window, 'enter-full-screen', 2500);
    const fullscreen = window.isFullScreen();
    if (entered || fullscreen) startBlocker();
    return {
      ok: fullscreen,
      fullscreen,
      error: fullscreen ? undefined : 'Windows did not enter fullscreen. Try again.',
    };
  });

  ipcMain.handle('experience:exit', async (event): Promise<FullscreenState> => {
    const window = assertTrusted(event);
    stopBlocker();
    if (window.isFullScreen()) {
      programmaticExit = true;
      window.setFullScreen(false);
      await waitForEvent(window, 'leave-full-screen', 2000);
    }
    programmaticExit = false;
    return { fullscreen: window.isFullScreen() };
  });

  ipcMain.handle('experience:is-fullscreen', (event) => {
    const window = assertTrusted(event);
    return window.isFullScreen();
  });

  ipcMain.handle('settings:load', (event) => {
    assertTrusted(event);
    return store.getSnapshot();
  });

  ipcMain.handle('settings:save', async (event, patch: unknown) => {
    assertTrusted(event);
    return store.saveSettings(sanitizeSettingsPatch(patch));
  });

  ipcMain.handle('settings:remember', async (event, file: unknown) => {
    assertTrusted(event);
    if (file === null || typeof file !== 'object') throw new Error('Invalid recent file.');
    const candidate = file as Partial<SelectedFile>;
    if (!isFileKind(candidate.kind)) throw new Error('Invalid recent file kind.');
    const validated = await validateSelectedPath(candidate.path, candidate.kind);
    if (!validated.ok) throw new Error(validated.error.message);
    await store.rememberFile(validated.file);
  });

  ipcMain.handle('settings:forget', async (event, kind: unknown) => {
    assertTrusted(event);
    if (!isFileKind(kind)) throw new Error('Invalid file kind.');
    await store.forgetFile(kind);
  });

  ipcMain.on('window:minimize', (event) => {
    const window = senderWindow(event as unknown as IpcMainInvokeEvent);
    window?.minimize();
  });

  ipcMain.on('window:toggle-maximize', (event) => {
    const window = senderWindow(event as unknown as IpcMainInvokeEvent);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.on('window:close', (event) => {
    const window = senderWindow(event as unknown as IpcMainInvokeEvent);
    window?.close();
  });

  const window = getWindow();
  if (window) {
    window.on('leave-full-screen', () => {
      stopBlocker();
      if (programmaticExit) {
        programmaticExit = false;
        return;
      }
      sendExitRequest('os');
    });
    window.on('closed', () => {
      stopBlocker();
    });
  }

  if (!isPackaged) {
    console.info('[afterglow] IPC registered in development mode');
  }
}
