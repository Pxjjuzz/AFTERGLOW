import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AfterglowApi,
  AppSettings,
  AudioLevelReport,
  AutoApi,
  AutoSettings,
  AutoStatus,
  CaptureStateReport,
  ExitRequest,
  FileKind,
  ManualOpenRequest,
  MediaSessionInfo,
  OverlayPayload,
  PlaybackUpdate,
  SelectedFile,
} from '../shared/ipc';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const auto: AutoApi = {
  getStatus: () => ipcRenderer.invoke('auto:get-status') as Promise<AutoStatus>,
  start: () => ipcRenderer.invoke('auto:start') as Promise<AutoStatus>,
  stop: () => ipcRenderer.invoke('auto:stop') as Promise<AutoStatus>,
  updateSettings: (patch: Partial<AutoSettings>) =>
    ipcRenderer.invoke('auto:update-settings', patch) as Promise<AutoStatus>,
  refreshSessions: () =>
    ipcRenderer.invoke('auto:refresh-sessions') as Promise<MediaSessionInfo[]>,
  importLyrics: () =>
    ipcRenderer.invoke('auto:import-lyrics') as Promise<{ ok: boolean; message: string }>,
  openManual: (request: ManualOpenRequest) =>
    ipcRenderer.invoke('auto:open-manual', request) as Promise<{ ok: boolean; message: string }>,
  preview: () =>
    ipcRenderer.invoke('auto:preview') as Promise<{ ok: boolean; message: string }>,
  exitOverlay: () => ipcRenderer.invoke('auto:exit-overlay') as Promise<void>,
  openSettings: () => ipcRenderer.send('auto:open-settings'),
  quit: () => ipcRenderer.send('auto:quit'),
  getOverlay: () => ipcRenderer.invoke('auto:get-overlay') as Promise<OverlayPayload | null>,
  getPlayback: () => ipcRenderer.invoke('auto:get-playback') as Promise<PlaybackUpdate>,
  reportCaptureState: (state: CaptureStateReport) =>
    ipcRenderer.send('auto:report-capture-state', state),
  reportAudioLevel: (levels: AudioLevelReport) =>
    ipcRenderer.send('auto:report-audio-level', levels),
  onStatus: (listener: (status: AutoStatus) => void) => subscribe('auto:status', listener),
  onOverlay: (listener: (payload: OverlayPayload | null) => void) =>
    subscribe('auto:overlay', listener),
  onPlayback: (listener: (update: PlaybackUpdate) => void) =>
    subscribe('auto:playback', listener),
};

const api: AfterglowApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    platform: (process.platform as AfterglowApi['app']['platform']) ?? 'win32',
  },
  files: {
    pick: (kind: FileKind) => ipcRenderer.invoke('files:pick', kind),
    validate: (kind: FileKind, path: string) => ipcRenderer.invoke('files:validate', kind, path),
    readLyrics: (path: string) => ipcRenderer.invoke('files:read-lyrics', path),
    pathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  media: {
    prepare: (path: string) => ipcRenderer.invoke('media:prepare', path),
    release: (token: string) => ipcRenderer.invoke('media:release', token) as Promise<void>,
  },
  experience: {
    enter: () => ipcRenderer.invoke('experience:enter'),
    exit: () => ipcRenderer.invoke('experience:exit'),
    isFullscreen: () => ipcRenderer.invoke('experience:is-fullscreen') as Promise<boolean>,
    onExitRequested: (listener: (request: ExitRequest) => void) =>
      subscribe('experience:exit-requested', listener),
  },
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', patch),
    remember: (file: SelectedFile) => ipcRenderer.invoke('settings:remember', file) as Promise<void>,
    forget: (kind: FileKind) => ipcRenderer.invoke('settings:forget', kind) as Promise<void>,
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  auto,
};

contextBridge.exposeInMainWorld('afterglow', api);
