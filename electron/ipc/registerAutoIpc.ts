import { BrowserWindow, dialog, ipcMain } from 'electron';
import type {
  AutoSettings,
  CaptureStateReport,
  ConstellationStyle,
  ManualOpenRequest,
  OverlayPayload,
} from '../../shared/ipc';
import { parseLrc } from '../../src/features/lyrics/lrcParser';
import type { AutoEngine } from '../auto/engine';
import { sanitizeAutoSettingsPatch, type AutoSettingsStore } from '../auto/autoSettings';
import { readLyricFile } from '../files/validation';

interface Appearance {
  style: ConstellationStyle;
  intensity: number;
  reducedMotion: boolean;
}

interface AutoIpcContext {
  getSettingsWindow: () => BrowserWindow | null;
  getOverlayWindow: () => BrowserWindow | null;
  engine: () => AutoEngine | null;
  autoSettings: () => AutoSettingsStore | null;
  getAppearance: () => Appearance;
  quit: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertTrusted(context: AutoIpcContext, sender: Electron.WebContents): void {
  const windows = [context.getSettingsWindow(), context.getOverlayWindow()];
  const trusted = windows.some(
    (window) => window && !window.isDestroyed() && window.webContents === sender,
  );
  if (!trusted) throw new Error('Rejected automatic-mode IPC from an untrusted sender.');
}

function requireEngine(context: AutoIpcContext): AutoEngine {
  const engine = context.engine();
  if (!engine) throw new Error('Automatic mode is not ready yet.');
  return engine;
}

function asLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function asCaptureReport(input: unknown): CaptureStateReport {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const status =
    record.status === 'off' ||
    record.status === 'starting' ||
    record.status === 'active' ||
    record.status === 'unavailable'
      ? record.status
      : 'off';
  const error =
    typeof record.error === 'string' && record.error.trim()
      ? record.error.trim().slice(0, 500)
      : null;
  return { status, error };
}

export function registerAutoIpc(context: AutoIpcContext): void {
  ipcMain.handle('auto:get-status', (event) => {
    assertTrusted(context, event.sender);
    return requireEngine(context).getStatus();
  });

  ipcMain.handle('auto:start', async (event) => {
    assertTrusted(context, event.sender);
    const store = context.autoSettings();
    const engine = requireEngine(context);
    if (store) {
      const next = await store.save({ enabled: true });
      engine.applySettings(next);
    }
    engine.start();
    return engine.getStatus();
  });

  ipcMain.handle('auto:stop', async (event) => {
    assertTrusted(context, event.sender);
    const store = context.autoSettings();
    const engine = requireEngine(context);
    if (store) {
      const next = await store.save({ enabled: false });
      engine.applySettings(next);
    } else {
      engine.stop();
    }
    return engine.getStatus();
  });

  ipcMain.handle('auto:update-settings', async (event, patch: unknown) => {
    assertTrusted(context, event.sender);
    const store = context.autoSettings();
    const engine = requireEngine(context);
    const sanitized: Partial<AutoSettings> = sanitizeAutoSettingsPatch(patch);
    if (!store) return engine.getStatus();
    const next = await store.save(sanitized);
    engine.applySettings(next);
    return engine.getStatus();
  });

  ipcMain.handle('auto:refresh-sessions', async (event) => {
    assertTrusted(context, event.sender);
    const engine = requireEngine(context);
    engine.refresh();
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const sessions = engine.getStatus().sessions;
      if (sessions.length > 0) return sessions;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return engine.getStatus().sessions;
  });

  ipcMain.handle('auto:import-lyrics', async (event) => {
    assertTrusted(context, event.sender);
    const engine = requireEngine(context);
    const window = context.getSettingsWindow() ?? BrowserWindow.fromWebContents(event.sender);
    if (!window) return { ok: false, message: 'The settings window is not available.' };
    const result = await dialog.showOpenDialog(window, {
      title: 'Import timestamped lyrics for the current track',
      properties: ['openFile'],
      filters: [{ name: 'LRC lyrics', extensions: ['lrc'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: 'No lyrics file was selected.' };
    }
    const read = await readLyricFile(result.filePaths[0]);
    if (!read.ok) return { ok: false, message: read.error.message };
    return engine.setManualLyrics(read.text);
  });

  ipcMain.handle('auto:open-manual', async (event, input: unknown) => {
    assertTrusted(context, event.sender);
    const engine = requireEngine(context);
    const record =
      input !== null && typeof input === 'object' ? (input as Partial<ManualOpenRequest>) : {};
    const token = typeof record.token === 'string' ? record.token : '';
    const lrc = typeof record.lrc === 'string' ? record.lrc : '';
    if (!UUID.test(token)) return { ok: false, message: 'The prepared audio source is invalid.' };

    const parsed = parseLrc(lrc);
    if (!parsed.ok || parsed.lyrics.lines.length === 0) {
      return {
        ok: false,
        message: parsed.ok ? 'That lyrics file has no timestamped lines.' : parsed.error.message,
      };
    }

    const appearance = context.getAppearance();
    const duration =
      typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0
        ? record.duration
        : 0;
    const title = typeof record.title === 'string' ? record.title.slice(0, 300) : 'Manual track';
    const artist = typeof record.artist === 'string' ? record.artist.slice(0, 300) : '';
    const album = typeof record.album === 'string' ? record.album.slice(0, 300) : '';

    const payload: OverlayPayload = {
      mode: 'manual',
      track: {
        key: `manual|${token}`,
        title,
        artist,
        album,
        duration,
        sourceApp: 'manual',
        position: 0,
        playing: true,
      },
      lyrics: {
        lrc,
        provider: 'manual',
        matchedTitle: title,
        matchedArtist: artist,
        matchedDuration: duration,
        score: 1,
        instrumental: false,
      },
      style: appearance.style,
      intensity: appearance.intensity,
      reducedMotion: appearance.reducedMotion,
      overlayControls: context.autoSettings()?.get().overlayControls ?? true,
      captureAudio: false,
      mediaUrl: `afterglow-media://track/${token}`,
      mediaToken: token,
      startPosition: 0,
    };

    engine.openManual(payload);
    return { ok: true, message: 'Opening the manual experience.' };
  });

  ipcMain.handle('auto:preview', (event) => {
    assertTrusted(context, event.sender);
    return requireEngine(context).preview();
  });

  ipcMain.handle('auto:exit-overlay', (event) => {
    assertTrusted(context, event.sender);
    requireEngine(context).exitOverlay();
  });

  ipcMain.handle('auto:get-overlay', (event) => {
    assertTrusted(context, event.sender);
    return requireEngine(context).getOverlay();
  });

  ipcMain.handle('auto:get-playback', (event) => {
    assertTrusted(context, event.sender);
    return requireEngine(context).getPlayback();
  });

  ipcMain.on('auto:open-settings', (event) => {
    assertTrusted(context, event.sender);
    const window = context.getSettingsWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  ipcMain.on('auto:quit', (event) => {
    assertTrusted(context, event.sender);
    context.quit();
  });

  ipcMain.on('auto:report-capture-state', (event, report: unknown) => {
    assertTrusted(context, event.sender);
    requireEngine(context).reportCaptureState(asCaptureReport(report));
  });

  ipcMain.on('auto:report-audio-level', (event, levels: unknown) => {
    assertTrusted(context, event.sender);
    const record =
      levels !== null && typeof levels === 'object' ? (levels as Record<string, unknown>) : {};
    requireEngine(context).reportAudioLevel({
      level: asLevel(record.level),
      bass: asLevel(record.bass),
      mid: asLevel(record.mid),
      treble: asLevel(record.treble),
    });
  });
}
