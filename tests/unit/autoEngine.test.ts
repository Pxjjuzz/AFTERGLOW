import { describe, expect, it, vi } from 'vitest';
import type {
  AutoSettings,
  AutoStatus,
  MediaSessionInfo,
  OverlayPayload,
  PlaybackUpdate,
} from '@shared/ipc';
import { AutoEngine } from '../../electron/auto/engine';
import { DEFAULT_AUTO_SETTINGS } from '../../electron/auto/autoSettings';
import type { MediaMonitor, MediaSnapshot } from '../../electron/media/smtcMonitor';
import type { LyricsLookupResult, LyricsProvider } from '../../electron/lyrics/types';

class ManualMonitor implements MediaMonitor {
  private readonly snapshotListeners = new Set<(snapshot: MediaSnapshot) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private active = false;

  get running(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  onSnapshot(listener: (snapshot: MediaSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emit(sessions: MediaSessionInfo[]): void {
    for (const listener of this.snapshotListeners) listener({ at: Date.now(), sessions });
  }

  fail(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }
}

const lrc = '[00:00.00]First light\n[00:04.00]Across the dark\n[00:08.00]We become constellations';

const lyricsPayload = {
  lrc,
  provider: 'lrclib' as const,
  matchedTitle: 'First Light',
  matchedArtist: 'AfterGlow',
  matchedDuration: 200,
  score: 0.94,
  instrumental: false,
};

function makeLyrics(result: LyricsLookupResult = { status: 'ready', payload: lyricsPayload }) {
  return { find: vi.fn(async () => result) } satisfies LyricsProvider;
}

function session(overrides: Partial<MediaSessionInfo> = {}): MediaSessionInfo {
  return {
    id: 'TestPlayer.exe',
    app: 'TestPlayer.exe',
    title: 'First Light',
    artist: 'AfterGlow',
    album: 'Sample',
    status: 'playing',
    position: 10,
    duration: 200,
    ...overrides,
  };
}

function settings(overrides: Partial<AutoSettings> = {}): AutoSettings {
  return {
    ...DEFAULT_AUTO_SETTINGS,
    entryDelayMs: 0,
    exitDelayMs: 1000,
    pauseDelayMs: 500,
    captureAudio: false,
    ...overrides,
  };
}

function makeEngine(options: {
  settings?: Partial<AutoSettings>;
  lyrics?: LyricsProvider;
  now?: () => number;
} = {}) {
  const monitor = new ManualMonitor();
  const lyrics = options.lyrics ?? makeLyrics();
  const overlays: Array<OverlayPayload | null> = [];
  const statuses: AutoStatus[] = [];
  const playback: PlaybackUpdate[] = [];
  let now = 1000;
  const engine = new AutoEngine({
    settings: settings(options.settings),
    monitor,
    lyrics,
    version: '2.0.0',
    autoTick: false,
    now: options.now ?? (() => now),
    hooks: {
      onStatus: (status) => statuses.push(status),
      onOverlay: (payload) => overlays.push(payload),
      onPlayback: (update) => playback.push(update),
    },
  });
  return {
    engine,
    monitor,
    lyrics,
    overlays,
    statuses,
    playback,
    setNow: (value: number) => {
      now = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
    getNow: () => now,
  };
}

describe('AutoEngine', () => {
  it('opens only after lyrics are ready and the entry delay has elapsed', async () => {
    const harness = makeEngine({ settings: { entryDelayMs: 500 } });
    harness.engine.start();
    expect(harness.monitor.running).toBe(true);

    harness.monitor.emit([session()]);
    await vi.waitFor(() =>
      expect(harness.engine.getStatus().lyricsStatus).toBe('ready'),
    );
    expect(harness.engine.getStatus().overlayVisible).toBe(false);

    harness.advance(499);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);

    harness.advance(1);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);
    expect(harness.overlays.at(-1)?.mode).toBe('auto');
    expect(harness.overlays.at(-1)?.track.title).toBe('First Light');
    expect(harness.overlays.at(-1)?.lyrics.provider).toBe('lrclib');

    // Once mounted, later ticks must not re-send the payload or steal focus.
    const emitted = harness.overlays.length;
    harness.engine.tick();
    harness.engine.tick();
    expect(harness.overlays.length).toBe(emitted);
    harness.engine.dispose();
  });

  it('ignores short playback such as notification sounds', async () => {
    const harness = makeEngine();
    harness.engine.start();
    harness.monitor.emit([session({ duration: 5, title: 'Ding' })]);
    await Promise.resolve();
    harness.engine.tick();

    expect(harness.engine.getStatus().lyricsStatus).toBe('not-found');
    expect(harness.engine.getStatus().lyricsMessage).toContain('notification sounds');
    expect(harness.lyrics.find).not.toHaveBeenCalled();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);
    harness.engine.dispose();
  });

  it('treats metadata-poor playback as a notification sound', async () => {
    const harness = makeEngine();
    harness.engine.start();
    harness.monitor.emit([
      session({ title: 'System sound', artist: '', album: '', duration: 0 }),
    ]);
    await Promise.resolve();
    harness.engine.tick();

    expect(harness.engine.getStatus().lyricsStatus).toBe('not-found');
    expect(harness.engine.getStatus().lyricsMessage).toContain('notification sound');
    expect(harness.lyrics.find).not.toHaveBeenCalled();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);
    harness.engine.dispose();
  });

  it('keeps the scene through a pause, then exits after the grace period when playback stops', async () => {
    const harness = makeEngine({ settings: { pauseBehavior: 'keep', exitDelayMs: 1000 } });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(1000);
    harness.monitor.emit([session({ status: 'paused', position: 20 })]);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(5000);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(1000);
    harness.monitor.emit([]);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(999);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(1);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);
    harness.engine.dispose();
  });

  it('hides after the pause delay when pause behaviour is hide', async () => {
    const harness = makeEngine({
      settings: { pauseBehavior: 'hide', pauseDelayMs: 500, exitDelayMs: 60_000 },
    });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(1000);
    harness.monitor.emit([session({ status: 'paused' })]);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.advance(500);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);
    harness.engine.dispose();
  });

  it('dismisses the current track on Escape and reopens after a resume', async () => {
    const harness = makeEngine({ settings: { exitDelayMs: 60_000 } });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.engine.exitOverlay();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);

    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(false);

    harness.monitor.emit([session({ status: 'paused' })]);
    harness.monitor.emit([session({ status: 'playing' })]);
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);
    harness.engine.dispose();
  });

  it('updates the scene on a track change without restarting', async () => {
    const harness = makeEngine({ settings: { exitDelayMs: 60_000 } });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.overlays.at(-1)?.track.title).toBe('First Light');

    harness.advance(10_000);
    harness.monitor.emit([
      session({
        title: 'Second Sky',
        artist: 'Another Artist',
        duration: 240,
        position: 0,
      }),
    ]);
    await vi.waitFor(() =>
      expect(harness.engine.getStatus().currentTrack?.title).toBe('Second Sky'),
    );
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.overlays.at(-1)?.track.title).toBe('Second Sky');
    expect(harness.overlays.at(-1)?.track.key).not.toContain('first light');
    harness.engine.dispose();
  });

  it('accepts manual LRC and rejects files without timestamps', async () => {
    const harness = makeEngine({ settings: { exitDelayMs: 60_000 } });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();

    expect(harness.engine.setManualLyrics('no timestamps here').ok).toBe(false);
    const result = harness.engine.setManualLyrics(lrc);
    expect(result.ok).toBe(true);
    expect(harness.engine.getStatus().lyricsStatus).toBe('manual');
    expect(harness.overlays.at(-1)?.lyrics.provider).toBe('manual');
    harness.engine.dispose();
  });

  it('refuses manual lyrics when there is no current track', () => {
    const harness = makeEngine();
    const result = harness.engine.setManualLyrics(lrc);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Play a track first');
    harness.engine.dispose();
  });

  it('reports loopback capture state and smooths audio levels', () => {
    const harness = makeEngine();
    harness.engine.reportCaptureState({ status: 'active', error: null });
    expect(harness.engine.getStatus().captureStatus).toBe('active');

    harness.engine.reportAudioLevel({ level: 0.8, bass: 0.7, mid: 0.5, treble: 0.3 });
    const status = harness.engine.getStatus();
    expect(status.audioLevel).toBeGreaterThan(0);
    expect(status.audioLevel).toBeLessThan(0.8);

    harness.engine.reportCaptureState({
      status: 'unavailable',
      error: 'loopback failed',
    });
    expect(harness.engine.getStatus().captureError).toBe('loopback failed');
    expect(harness.engine.getStatus().audioLevel).toBe(0);
    harness.engine.dispose();
  });

  it('extrapolates the player position between metadata samples', async () => {
    const harness = makeEngine();
    harness.engine.start();
    harness.monitor.emit([session({ position: 10, duration: 200 })]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));

    harness.advance(2000);
    const playback = harness.engine.getPlayback();
    expect(playback.position).toBeCloseTo(12, 1);
    expect(playback.playing).toBe(true);
    harness.engine.dispose();
  });

  it('stops monitoring and hides the overlay when automatic mode is disabled', async () => {
    const harness = makeEngine({ settings: { exitDelayMs: 60_000 } });
    harness.engine.start();
    harness.monitor.emit([session()]);
    await vi.waitFor(() => expect(harness.engine.getStatus().lyricsStatus).toBe('ready'));
    harness.engine.tick();
    expect(harness.engine.getStatus().overlayVisible).toBe(true);

    harness.engine.applySettings(settings({ enabled: false }));
    expect(harness.engine.getStatus().monitoring).toBe(false);
    expect(harness.monitor.running).toBe(false);
    expect(harness.engine.getStatus().overlayVisible).toBe(false);

    harness.engine.applySettings(settings({ enabled: true }));
    expect(harness.engine.getStatus().monitoring).toBe(true);
    expect(harness.monitor.running).toBe(true);
    harness.engine.dispose();
  });

  it('reports media helper failures without crashing', () => {
    const harness = makeEngine();
    harness.engine.start();
    harness.monitor.fail('WinRT unavailable');
    const status = harness.engine.getStatus();
    expect(status.mediaAvailable).toBe(false);
    expect(status.mediaError).toBe('WinRT unavailable');
    expect(status.lastError).toBe('WinRT unavailable');
    harness.engine.dispose();
  });
});
