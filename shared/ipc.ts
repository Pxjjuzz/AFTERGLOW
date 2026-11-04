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

/* ------------------------------------------------------------------ */
/* AfterGlowV2: automatic ambient mode                                 */
/* ------------------------------------------------------------------ */

export type MediaPlaybackStatus =
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'closed'
  | 'changing'
  | 'opened'
  | 'unknown';

export interface MediaSessionInfo {
  /** Windows SourceAppUserModelId, also used as the stable app id. */
  id: string;
  app: string;
  title: string;
  artist: string;
  album: string;
  status: MediaPlaybackStatus;
  /** Seconds. */
  position: number;
  /** Seconds. */
  duration: number;
}

export type CaptureStatus = 'off' | 'starting' | 'active' | 'unavailable';

export interface AutoSettings {
  /** Keep watching Windows media sessions for playback. */
  enabled: boolean;
  /** '' monitors every player, otherwise a SourceAppUserModelId. */
  monitoredPlayer: string;
  /** Sustained playback required before the overlay opens. */
  entryDelayMs: number;
  /** Grace period after playback stops before the overlay hides. */
  exitDelayMs: number;
  /** How long a pause is tolerated before the pause behaviour applies. */
  pauseDelayMs: number;
  pauseBehavior: 'keep' | 'hide';
  /** Allow LRCLIB lookups over the network. */
  onlineLyrics: boolean;
  /** Use Electron's WASAPI loopback capture for level gating. */
  captureAudio: boolean;
  /** Show the temporary track pill when the pointer moves or H is pressed. */
  overlayControls: boolean;
}

export type LyricsStatus =
  | 'idle'
  | 'searching'
  | 'ready'
  | 'not-found'
  | 'disabled'
  | 'error'
  | 'manual';

export interface AutoTrackInfo {
  key: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  sourceApp: string;
  position: number;
  playing: boolean;
}

export interface AutoLyricsPayload {
  lrc: string;
  provider: 'lrclib' | 'cache' | 'manual';
  matchedTitle: string;
  matchedArtist: string;
  matchedDuration: number;
  score: number;
  instrumental: boolean;
}

export interface AutoStatus {
  enabled: boolean;
  monitoring: boolean;
  mediaAvailable: boolean;
  mediaError: string | null;
  captureStatus: CaptureStatus;
  captureError: string | null;
  audioLevel: number;
  sessions: MediaSessionInfo[];
  currentTrack: AutoTrackInfo | null;
  lyricsStatus: LyricsStatus;
  lyricsMessage: string | null;
  overlayVisible: boolean;
  lastError: string | null;
  settings: AutoSettings;
  version: string;
}

export interface OverlayPayload {
  mode: 'auto' | 'manual';
  track: AutoTrackInfo;
  lyrics: AutoLyricsPayload;
  style: ConstellationStyle;
  intensity: number;
  reducedMotion: boolean;
  overlayControls: boolean;
  /** Ask the overlay renderer to start Windows loopback capture for levels. */
  captureAudio?: boolean;
  /** Manual mode only: a prepared afterglow-media URL. */
  mediaUrl?: string;
  mediaToken?: string;
  startPosition?: number;
}

export interface PlaybackUpdate {
  position: number;
  playing: boolean;
  duration: number;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** Wall-clock milliseconds when this sample was produced. */
  at: number;
}

export interface AudioLevelReport {
  level: number;
  bass: number;
  mid: number;
  treble: number;
}

export interface CaptureStateReport {
  status: CaptureStatus;
  error: string | null;
}

export interface ManualOpenRequest {
  token: string;
  lrc: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface AutoApi {
  getStatus(): Promise<AutoStatus>;
  start(): Promise<AutoStatus>;
  stop(): Promise<AutoStatus>;
  updateSettings(patch: Partial<AutoSettings>): Promise<AutoStatus>;
  refreshSessions(): Promise<MediaSessionInfo[]>;
  importLyrics(): Promise<{ ok: boolean; message: string }>;
  openManual(request: ManualOpenRequest): Promise<{ ok: boolean; message: string }>;
  preview(): Promise<{ ok: boolean; message: string }>;
  exitOverlay(): Promise<void>;
  openSettings(): void;
  quit(): void;
  getOverlay(): Promise<OverlayPayload | null>;
  getPlayback(): Promise<PlaybackUpdate>;
  reportCaptureState(state: CaptureStateReport): void;
  reportAudioLevel(levels: AudioLevelReport): void;
  onStatus(listener: (status: AutoStatus) => void): () => void;
  onOverlay(listener: (payload: OverlayPayload | null) => void): () => void;
  onPlayback(listener: (update: PlaybackUpdate) => void): () => void;
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
  auto: AutoApi;
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
