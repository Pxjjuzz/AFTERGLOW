import type {
  AutoLyricsPayload,
  AutoSettings,
  AutoStatus,
  AutoTrackInfo,
  CaptureStateReport,
  CaptureStatus,
  ConstellationStyle,
  LyricsStatus,
  MediaSessionInfo,
  OverlayPayload,
  PlaybackUpdate,
} from '../../shared/ipc';
import { parseLrc } from '../../src/features/lyrics/lrcParser';
import type { MediaMonitor, MediaSnapshot } from '../media/smtcMonitor';
import type { LyricsProvider } from '../lyrics/types';

/** Brief system sounds are not worth a fullscreen takeover. */
export const MIN_TRACK_SECONDS = 20;
const TICK_MS = 250;
const STATUS_INTERVAL_MS = 1000;
const PLAYBACK_INTERVAL_MS = 220;

export interface AutoEngineHooks {
  onStatus(status: AutoStatus): void;
  onOverlay(payload: OverlayPayload | null): void;
  onPlayback(update: PlaybackUpdate): void;
}

export interface AutoEngineOptions {
  settings: AutoSettings;
  monitor: MediaMonitor;
  lyrics: LyricsProvider;
  hooks: AutoEngineHooks;
  version: string;
  style?: ConstellationStyle;
  intensity?: number;
  reducedMotion?: boolean;
  now?: () => number;
  /** Tests drive ticks manually. */
  autoTick?: boolean;
}

export interface ManualOverlayRequest {
  payload: OverlayPayload;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function text(value: string): string {
  return value.trim();
}

export function trackKeyFromSession(session: MediaSessionInfo): string {
  return [
    session.id,
    text(session.title).toLowerCase(),
    text(session.artist).toLowerCase(),
    Math.round(session.duration),
  ].join('|');
}

function sessionIsPlaying(session: MediaSessionInfo): boolean {
  return session.status === 'playing';
}

export class AutoEngine {
  private readonly monitor: MediaMonitor;
  private readonly provider: LyricsProvider;
  private readonly hooks: AutoEngineHooks;
  private readonly now: () => number;
  private readonly autoTick: boolean;
  private readonly version: string;
  private readonly style: ConstellationStyle;
  private readonly intensity: number;
  private readonly reducedMotion: boolean;

  private settings: AutoSettings;
  private sessions: MediaSessionInfo[] = [];
  private snapshotAt = 0;
  private track: AutoTrackInfo | null = null;
  private trackSince = 0;
  private pausedSince = 0;
  private stoppedSince = 0;
  private trackStopped = false;
  private dismissedTrackKey: string | null = null;

  private lyricsStatus: LyricsStatus = 'idle';
  private lyricsMessage: string | null = null;
  private lyrics: AutoLyricsPayload | null = null;
  private manualLyrics: AutoLyricsPayload | null = null;
  private manualLyricsTrackKey: string | null = null;
  private lookupGeneration = 0;

  private overlayVisible = false;
  private overlayPayload: OverlayPayload | null = null;
  private manualPayload: OverlayPayload | null = null;

  private monitoring = false;
  private started = false;
  private mediaAvailable = false;
  private mediaError: string | null = null;
  private captureStatus: CaptureStatus = 'off';
  private captureError: string | null = null;
  private levels = { level: 0, bass: 0, mid: 0, treble: 0 };
  private lastError: string | null = null;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatusAt = 0;
  private lastPlaybackAt = 0;

  constructor(options: AutoEngineOptions) {
    this.settings = { ...options.settings };
    this.monitor = options.monitor;
    this.provider = options.lyrics;
    this.hooks = options.hooks;
    this.now = options.now ?? Date.now;
    this.autoTick = options.autoTick ?? true;
    this.version = options.version;
    this.style = options.style ?? 'constellation';
    this.intensity = options.intensity ?? 1;
    this.reducedMotion = options.reducedMotion ?? false;

    this.monitor.onSnapshot((snapshot) => this.handleSnapshot(snapshot));
    this.monitor.onError((message) => this.handleMonitorError(message));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.monitoring = true;
    this.mediaError = null;
    this.monitor.start();
    if (this.autoTick) {
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }
    this.emitStatus();
  }

  stop(): void {
    this.started = false;
    this.monitoring = false;
    this.monitor.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.hideOverlay();
    this.track = null;
    this.sessions = [];
    this.pausedSince = 0;
    this.stoppedSince = 0;
    this.trackStopped = false;
    this.dismissedTrackKey = null;
    this.lyrics = null;
    this.lyricsStatus = 'idle';
    this.lyricsMessage = null;
    this.emitStatus();
  }

  dispose(): void {
    this.started = false;
    this.monitoring = false;
    this.monitor.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  applySettings(next: AutoSettings): void {
    const previous = this.settings;
    const playerChanged = next.monitoredPlayer !== previous.monitoredPlayer;
    const visualChanged =
      next.captureAudio !== previous.captureAudio ||
      next.overlayControls !== previous.overlayControls;
    this.settings = { ...next };
    if (!next.enabled) {
      if (this.started) this.stop();
      else this.hideOverlay();
      return;
    }
    if (!this.started) this.start();
    if (playerChanged) {
      this.track = null;
      this.lyrics = null;
      this.lyricsStatus = 'idle';
      this.lyricsMessage = null;
      this.lookupGeneration += 1;
      this.hideOverlay();
    }
    if (!next.captureAudio) {
      this.captureStatus = 'off';
      this.captureError = null;
      this.levels = { level: 0, bass: 0, mid: 0, treble: 0 };
    }
    if (visualChanged && this.overlayVisible && this.overlayPayload?.mode === 'auto') {
      const payload = this.buildPayload();
      if (payload) this.showOverlay(payload);
    }
    this.emitStatus();
  }

  refresh(): void {
    this.monitor.stop();
    this.monitor.start();
    this.emitStatus();
  }

  handleSnapshot(snapshot: MediaSnapshot): void {
    this.sessions = snapshot.sessions;
    this.snapshotAt = this.now();
    this.mediaAvailable = true;
    this.mediaError = null;
    this.updateTrack();
    this.tick();
  }

  handleMonitorError(message: string): void {
    this.mediaAvailable = false;
    this.mediaError = message;
    this.lastError = message;
    this.emitStatus();
  }

  reportCaptureState(report: CaptureStateReport): void {
    this.captureStatus = report.status;
    this.captureError = report.error;
    if (report.status !== 'active') {
      this.levels = { level: 0, bass: 0, mid: 0, treble: 0 };
    }
    this.emitStatus();
  }

  reportAudioLevel(levels: {
    level: number;
    bass: number;
    mid: number;
    treble: number;
  }): void {
    const attack = 0.55;
    const release = 0.14;
    const smooth = (previous: number, next: number): number => {
      const value = clamp01(next);
      return previous + (value - previous) * (value > previous ? attack : release);
    };
    this.levels = {
      level: smooth(this.levels.level, levels.level),
      bass: smooth(this.levels.bass, levels.bass),
      mid: smooth(this.levels.mid, levels.mid),
      treble: smooth(this.levels.treble, levels.treble),
    };
  }

  setManualLyrics(lrc: string): { ok: boolean; message: string } {
    if (!this.track) {
      return {
        ok: false,
        message: 'Play a track first, then import timestamped lyrics for it.',
      };
    }
    const parsed = parseLrc(lrc);
    if (!parsed.ok) return { ok: false, message: parsed.error.message };
    if (parsed.lyrics.lines.length === 0) {
      return { ok: false, message: 'That lyrics file has no timestamped lines.' };
    }
    const payload: AutoLyricsPayload = {
      lrc,
      provider: 'manual',
      matchedTitle: this.track?.title ?? 'Manual lyrics',
      matchedArtist: this.track?.artist ?? '',
      matchedDuration: this.track?.duration ?? 0,
      score: 1,
      instrumental: false,
    };
    this.manualLyrics = payload;
    this.manualLyricsTrackKey = this.track?.key ?? null;
    if (this.track) {
      this.lyrics = payload;
      this.lyricsStatus = 'manual';
      this.lyricsMessage = 'Using the .lrc file you imported.';
      this.lookupGeneration += 1;
      if (this.overlayVisible && this.track.playing) {
        const payload = this.buildPayload();
        if (payload) this.showOverlay(payload);
      }
    }
    this.emitStatus();
    return { ok: true, message: 'Manual lyrics are ready for the current track.' };
  }

  openManual(payload: OverlayPayload): void {
    this.manualPayload = { ...payload, mode: 'manual', overlayControls: this.settings.overlayControls };
    this.overlayVisible = true;
    this.hooks.onOverlay(this.manualPayload);
    this.emitStatus();
  }

  preview(): { ok: boolean; message: string } {
    if (this.manualPayload) {
      this.overlayVisible = true;
      this.hooks.onOverlay(this.manualPayload);
      this.emitStatus();
      return { ok: true, message: 'Previewing the current manual scene.' };
    }
    if (!this.track || !this.lyrics) {
      return {
        ok: false,
        message:
          this.lyricsMessage ??
          'Nothing is ready to preview yet. Play a track in a supported player first.',
      };
    }
    const payload = this.buildPayload();
    if (!payload) return { ok: false, message: 'The preview scene could not be built.' };
    this.showOverlay(payload);
    return { ok: true, message: 'Previewing the current track.' };
  }

  exitOverlay(): void {
    if (this.manualPayload) {
      this.manualPayload = null;
      this.hideOverlay();
      return;
    }
    if (this.track && this.overlayPayload?.mode === 'auto') {
      // Esc means "not this track". Playback resuming or a track change clears
      // the dismissal, so the user is not locked out for the rest of the night.
      this.dismissedTrackKey = this.track.key;
    }
    this.hideOverlay();
  }

  getOverlay(): OverlayPayload | null {
    return this.manualPayload ?? this.overlayPayload;
  }

  getPlayback(): PlaybackUpdate {
    const now = this.now();
    const track = this.track;
    return {
      position: this.positionAt(now),
      playing: Boolean(track?.playing),
      duration: track?.duration ?? 0,
      level: this.levels.level,
      bass: this.levels.bass,
      mid: this.levels.mid,
      treble: this.levels.treble,
      at: now,
    };
  }

  getStatus(): AutoStatus {
    const now = this.now();
    return {
      enabled: this.settings.enabled,
      monitoring: this.monitoring,
      mediaAvailable: this.mediaAvailable,
      mediaError: this.mediaError,
      captureStatus: this.captureStatus,
      captureError: this.captureError,
      audioLevel: this.levels.level,
      sessions: this.sessions,
      currentTrack: this.track
        ? {
            ...this.track,
            position: this.positionAt(now),
            playing: this.track.playing,
          }
        : null,
      lyricsStatus: this.lyricsStatus,
      lyricsMessage: this.lyricsMessage,
      overlayVisible: this.overlayVisible,
      lastError: this.lastError,
      settings: { ...this.settings },
      version: this.version,
    };
  }

  tick(): void {
    if (!this.started && !this.manualPayload) return;
    const now = this.now();
    const track = this.track;

    if (track) {
      if (track.playing) {
        if (this.shouldShowOverlay(now)) {
          const payload = this.buildPayload();
          if (payload) this.showOverlay(payload);
        }
      } else if (
        this.overlayVisible &&
        !this.manualPayload &&
        this.overlayPayload?.mode === 'auto' &&
        this.settings.pauseBehavior === 'hide' &&
        this.pausedSince > 0 &&
        now - this.pausedSince >= this.settings.pauseDelayMs
      ) {
        this.hideOverlay();
      }

      if (
        this.trackStopped &&
        this.stoppedSince > 0 &&
        this.overlayVisible &&
        !this.manualPayload &&
        this.overlayPayload?.mode === 'auto' &&
        now - this.stoppedSince >= this.settings.exitDelayMs
      ) {
        this.hideOverlay();
      }
    }

    if (this.overlayVisible && this.overlayPayload?.mode === 'auto') {
      if (now - this.lastPlaybackAt >= PLAYBACK_INTERVAL_MS) {
        this.lastPlaybackAt = now;
        this.hooks.onPlayback(this.getPlayback());
      }
    }

    if (now - this.lastStatusAt >= STATUS_INTERVAL_MS) {
      this.emitStatus();
    }
  }

  private selectSession(): MediaSessionInfo | null {
    const candidates = this.settings.monitoredPlayer
      ? this.sessions.filter(
          (session) =>
            session.id === this.settings.monitoredPlayer ||
            session.app === this.settings.monitoredPlayer,
        )
      : this.sessions;

    const currentId = this.track?.sourceApp;
    const currentPlaying = currentId
      ? candidates.find((session) => session.app === currentId && sessionIsPlaying(session))
      : undefined;
    if (currentPlaying) return currentPlaying;

    const playing = candidates.find((session) => sessionIsPlaying(session));
    if (playing) return playing;

    return (
      candidates.find(
        (session) =>
          session.status === 'paused' ||
          session.status === 'changing' ||
          session.status === 'opened',
      ) ?? null
    );
  }

  private updateTrack(): void {
    const now = this.now();
    const session = this.selectSession();

    if (!session) {
      if (this.track) this.track = { ...this.track, playing: false };
      this.trackStopped = true;
      if (this.stoppedSince === 0) this.stoppedSince = now;
      if (
        this.overlayVisible &&
        !this.manualPayload &&
        this.overlayPayload?.mode === 'auto' &&
        now - this.stoppedSince >= this.settings.exitDelayMs
      ) {
        this.hideOverlay();
      }
      if (this.track && now - this.stoppedSince >= this.settings.exitDelayMs + 1000) {
        this.track = null;
        this.trackStopped = false;
        this.stoppedSince = 0;
        this.lyrics = null;
        this.lyricsStatus = 'idle';
        this.lyricsMessage = null;
      }
      return;
    }

    this.stoppedSince = 0;
    const key = trackKeyFromSession(session);
    const playing = sessionIsPlaying(session);

    if (!this.track || this.track.key !== key) {
      // A different track means the previous scene is no longer truthful. Hide
      // it now and wait for the new track's lyrics before re-entering.
      if (this.overlayVisible && !this.manualPayload && this.overlayPayload?.mode === 'auto') {
        this.hideOverlay();
      }
      this.track = {
        key,
        title: text(session.title),
        artist: text(session.artist),
        album: text(session.album),
        duration: session.duration,
        sourceApp: session.app,
        position: session.position,
        playing,
      };
      this.trackSince = now;
      this.snapshotAt = now;
      this.pausedSince = playing ? 0 : now;
      this.trackStopped = false;
      this.stoppedSince = 0;
      this.dismissedTrackKey = null;
      this.lyrics = null;
      this.lyricsStatus = 'idle';
      this.lyricsMessage = null;
      this.lookupGeneration += 1;

      if (this.manualLyrics && this.manualLyricsTrackKey === key) {
        this.lyrics = this.manualLyrics;
        this.lyricsStatus = 'manual';
        this.lyricsMessage = 'Using the .lrc file you imported.';
      } else if (this.track.duration > 0 && this.track.duration < MIN_TRACK_SECONDS) {
        this.lyricsStatus = 'not-found';
        this.lyricsMessage = 'Short playback was ignored so notification sounds do not open the scene.';
      } else if (this.track.duration <= 0 && !this.track.artist) {
        this.lyricsStatus = 'not-found';
        this.lyricsMessage =
          'The player exposed too little metadata (no artist or duration), so this was treated as a notification sound.';
      } else if (this.track.title) {
        void this.startLookup(this.track);
      } else {
        this.lyricsStatus = 'not-found';
        this.lyricsMessage =
          'The player exposed playback but not a track title, so lyrics cannot be matched.';
      }
      return;
    }

    const wasPlaying = this.track.playing;
    this.track = {
      ...this.track,
      title: text(session.title) || this.track.title,
      artist: text(session.artist) || this.track.artist,
      album: text(session.album) || this.track.album,
      duration: session.duration > 0 ? session.duration : this.track.duration,
      position: session.position,
      playing,
    };
    this.snapshotAt = now;
    this.trackStopped = false;
    this.stoppedSince = 0;

    if (playing) {
      if (!wasPlaying) {
        this.pausedSince = 0;
        this.dismissedTrackKey = null;
      }
    } else if (wasPlaying) {
      this.pausedSince = now;
    }
  }

  private async startLookup(track: AutoTrackInfo): Promise<void> {
    const generation = this.lookupGeneration;
    this.lyricsStatus = 'searching';
    this.lyricsMessage = 'Searching for timestamped lyrics…';
    this.emitStatus();

    try {
      const result = await this.provider.find({
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
      });
      if (generation !== this.lookupGeneration) return;
      if (this.track?.key !== track.key) return;

      if (result.status === 'ready') {
        this.lyrics = result.payload;
        this.lyricsStatus = 'ready';
        this.lyricsMessage = `Matched ${result.payload.matchedTitle}${
          result.payload.matchedArtist ? ` — ${result.payload.matchedArtist}` : ''
        } (${Math.round(result.payload.score * 100)}%).`;
        if (this.overlayVisible && this.track.playing) {
          const payload = this.buildPayload();
          if (payload) this.showOverlay(payload);
        }
      } else if (result.status === 'instrumental') {
        this.lyricsStatus = 'not-found';
        this.lyricsMessage = result.message;
      } else if (result.status === 'disabled') {
        this.lyricsStatus = 'disabled';
        this.lyricsMessage = result.message;
      } else if (result.status === 'not-found') {
        this.lyricsStatus = 'not-found';
        this.lyricsMessage = result.message;
      } else {
        this.lyricsStatus = 'error';
        this.lyricsMessage = result.message;
        this.lastError = result.message;
      }
      this.emitStatus();
    } catch (error) {
      if (generation !== this.lookupGeneration) return;
      this.lyricsStatus = 'error';
      this.lyricsMessage =
        error instanceof Error ? error.message : 'The lyrics lookup failed unexpectedly.';
      this.lastError = this.lyricsMessage;
      this.emitStatus();
    }
  }

  private shouldShowOverlay(now: number): boolean {
    const track = this.track;
    if (!this.settings.enabled || !this.monitoring || !track) return false;
    // The overlay stays mounted until pause/exit handling hides it. Re-sending
    // the payload every tick would steal focus and spam IPC.
    if (this.overlayVisible) return false;
    if (!track.playing || !this.lyrics) return false;
    if (this.lyricsStatus !== 'ready' && this.lyricsStatus !== 'manual') return false;
    if (this.dismissedTrackKey === track.key) return false;
    if (track.duration > 0 && track.duration < MIN_TRACK_SECONDS) return false;
    return now - this.trackSince >= this.settings.entryDelayMs;
  }

  private buildPayload(): OverlayPayload | null {
    if (!this.track || !this.lyrics) return null;
    return {
      mode: 'auto',
      track: {
        ...this.track,
        position: this.positionAt(this.now()),
        playing: this.track.playing,
      },
      lyrics: this.lyrics,
      style: this.style,
      intensity: this.intensity,
      reducedMotion: this.reducedMotion,
      overlayControls: this.settings.overlayControls,
      captureAudio: this.settings.captureAudio,
    };
  }

  private showOverlay(payload: OverlayPayload): void {
    this.overlayPayload = payload;
    this.overlayVisible = true;
    this.hooks.onOverlay(payload);
    this.emitStatus();
  }

  private hideOverlay(): void {
    const wasVisible = this.overlayVisible || this.overlayPayload !== null;
    this.overlayVisible = false;
    this.overlayPayload = null;
    this.manualPayload = null;
    if (wasVisible) this.hooks.onOverlay(null);
    this.emitStatus();
  }

  private positionAt(now: number): number {
    const track = this.track;
    if (!track) return 0;
    const elapsed = track.playing ? Math.max(0, (now - this.snapshotAt) / 1000) : 0;
    const position = track.position + elapsed;
    if (track.duration > 0) return Math.min(track.duration, position);
    return position;
  }



  private emitStatus(): void {
    this.lastStatusAt = this.now();
    this.hooks.onStatus(this.getStatus());
  }
}
