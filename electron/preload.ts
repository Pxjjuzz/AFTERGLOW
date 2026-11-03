import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AfterglowApi,
  AppSettings,
  ExitRequest,
  FileKind,
  SelectedFile,
} from '../shared/ipc';

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
    onExitRequested: (listener: (request: ExitRequest) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: ExitRequest) => listener(request);
      ipcRenderer.on('experience:exit-requested', handler);
      return () => ipcRenderer.removeListener('experience:exit-requested', handler);
    },
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
};

contextBridge.exposeInMainWorld('afterglow', api);
