/**
 * The complete, narrowly-scoped contract between the renderer and the main
 * process. Nothing here exposes filesystem primitives directly: the renderer
 * only receives validated descriptors, lyric text, or a tokenised media URL.
 */

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.flac',
  '.m4a',
  '.aac',
  '.webm',
] as const;

export const LYRICS_EXTENSIONS = ['.lrc'] as const;

export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
export const MAX_LYRICS_BYTES = 2 * 1024 * 1024;

export type FileKind = 'audio' | 'lyrics';

export type FileErrorCode =
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'NOT_A_FILE'
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'UNREADABLE'
  | 'DIALOG_ERROR';

export interface FileError {
  code: FileErrorCode;
  message: string;
}

export interface SelectedFile {
  path: string;
  name: string;
  kind: FileKind;
  extension: string;
  size: number;
}

export type FileResult = { ok: true; file: SelectedFile } | { ok: false; error: FileError };

export interface LyricFileResult {
  ok: true;
  file: SelectedFile;
  text: string;
}
export type LyricReadResult = LyricFileResult | { ok: false; error: FileError };

export interface RecentFile {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  lastOpenedAt: number;
}

export type ReducedMotionSetting = 'auto' | 'on' | 'off';
export type WordRevealMode = 'sequential' | 'even';
export type ConstellationStyle = 'constellation' | 'starfield' | 'kinetic';

export interface AppSettings {
  /** Positive values delay lyric lines; negative values advance them. */
  offsetMs: number;
  intensity: number;
  reducedMotion: ReducedMotionSetting;
  temporaryControls: boolean;
  wordReveal: WordRevealMode;
  constellationStyle: ConstellationStyle;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  recent: {
    audio: RecentFile | null;
    lyrics: RecentFile | null;
  };
}

export interface MediaSource {
  url: string;
  token: string;
  mimeType: string;
  size: number;
}

export interface FullscreenState {
  fullscreen: boolean;
}

export interface ExitRequest {
  reason: 'escape' | 'os' | 'error' | 'request';
}

export interface AfterglowApi {
  app: {
    getVersion(): Promise<string>;
    platform: 'win32' | 'darwin' | 'linux';
  };
  files: {
    pick(kind: FileKind): Promise<FileResult | { ok: false; canceled: true }>;
    validate(kind: FileKind, path: string): Promise<FileResult>;
    readLyrics(path: string): Promise<LyricReadResult>;
    /** Electron's webUtils path resolution for drag-and-drop File objects. */
    pathForFile(file: File): string;
  };
  media: {
    prepare(path: string): Promise<{ ok: true; source: MediaSource } | { ok: false; error: FileError }>;
    release(token: string): Promise<void>;
  };
  experience: {
    enter(): Promise<{ ok: boolean; fullscreen: boolean; error?: string }>;
    exit(): Promise<FullscreenState>;
    isFullscreen(): Promise<boolean>;
    onExitRequested(listener: (request: ExitRequest) => void): () => void;
  };
  settings: {
    load(): Promise<SettingsSnapshot>;
    save(patch: Partial<AppSettings>): Promise<SettingsSnapshot>;
    remember(file: SelectedFile): Promise<void>;
    forget(kind: FileKind): Promise<void>;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  offsetMs: 0,
  intensity: 1,
  reducedMotion: 'auto',
  temporaryControls: true,
  wordReveal: 'sequential',
  constellationStyle: 'constellation',
};

export function isFileKind(value: unknown): value is FileKind {
  return value === 'audio' || value === 'lyrics';
}
