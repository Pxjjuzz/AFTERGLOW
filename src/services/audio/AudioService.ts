import { SILENT_SPECTRUM, averageBand, type SpectrumLevels } from '@/lib/spectrum';

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export interface AudioSnapshot {
  status: AudioStatus;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
}

export class AudioServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'LOAD_FAILED' | 'PLAY_FAILED' | 'NO_SOURCE' | 'DECODE_FAILED',
  ) {
    super(message);
    this.name = 'AudioServiceError';
  }
}

function mediaErrorMessage(error: MediaError | null): string {
  if (!error) return 'The audio could not be played.';
  switch (error.code) {
    case 1:
      return 'Audio playback was interrupted.';
    case 2:
      return 'The audio could not be read. The file may be incomplete or unavailable.';
    case 3:
      return 'This audio file could not be decoded. Try MP3, WAV, OGG, or FLAC.';
    case 4:
      return 'This audio format is not supported by the playback engine.';
    default:
      return 'The audio could not be played.';
  }
}

/**
 * Wraps a single HTMLAudioElement. Its currentTime is the only authoritative
 * playback clock; the lyric timeline is evaluated against it every frame.
 */
export class AudioService {
  private readonly audio: HTMLAudioElement;
  private readonly listeners = new Set<(snapshot: AudioSnapshot) => void>();
  private status: AudioStatus = 'idle';
  private error: string | null = null;
  private playPromise: Promise<void> | null = null;
  private destroyed = false;
  private loadedMetadataHandler: (() => void) | null = null;
  private loadedErrorHandler: (() => void) | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrumData: Uint8Array<ArrayBuffer> | null = null;
  private analyserUnavailable = false;

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;
    this.audio.preload = 'auto';
    // The media protocol answers with Access-Control-Allow-Origin, so the
    // element can feed a WebAudio analyser without tainting it.
    this.audio.crossOrigin = 'anonymous';
    this.audio.addEventListener('loadedmetadata', this.onMetadata);
    this.audio.addEventListener('durationchange', this.onMetadata);
    this.audio.addEventListener('play', this.onPlay);
    this.audio.addEventListener('pause', this.onPause);
    this.audio.addEventListener('ended', this.onEnded);
    this.audio.addEventListener('error', this.onError);
    this.audio.addEventListener('canplay', this.onCanPlay);
  }

  private snapshot(): AudioSnapshot {
    return {
      status: this.status,
      duration: this.duration,
      volume: this.audio.volume,
      muted: this.audio.muted,
      error: this.error,
    };
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private setStatus(status: AudioStatus, error: string | null = null): void {
    this.status = status;
    this.error = error;
    this.notify();
  }

  private onMetadata = (): void => {
    if (this.status === 'loading') {
      this.status = 'ready';
      this.notify();
    }
    this.loadedMetadataHandler?.();
  };

  private onCanPlay = (): void => {
    this.loadedMetadataHandler?.();
  };

  private onPlay = (): void => {
    if (this.status !== 'error') this.setStatus('playing');
  };

  private onPause = (): void => {
    if (this.status === 'ended' || this.status === 'error') return;
    this.setStatus('paused');
  };

  private onEnded = (): void => {
    this.setStatus('ended');
  };

  private onError = (): void => {
    const message = mediaErrorMessage(this.audio.error);
    this.setStatus('error', message);
    this.loadedErrorHandler?.();
  };

  subscribe(listener: (snapshot: AudioSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  get currentTime(): number {
    return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : 0;
  }

  get isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  get hasSource(): boolean {
    return Boolean(this.audio.currentSrc || this.audio.src);
  }

  getSnapshot(): AudioSnapshot {
    return this.snapshot();
  }

  /**
   * Route the element through a WebAudio analyser so the renderer can react to
   * the music. If the context cannot start (autoplay policy, no device), the
   * element keeps playing through its default path and the spectrum stays silent.
   */
  private async ensureAnalyser(): Promise<void> {
    if (this.analyser || this.analyserUnavailable || this.destroyed) return;
    try {
      const context = new AudioContext();
      if (context.state === 'suspended') await context.resume();
      if (context.state !== 'running') {
        await context.close();
        this.analyserUnavailable = true;
        return;
      }
      const source = context.createMediaElementSource(this.audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.audioContext = context;
      this.analyser = analyser;
      this.spectrumData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      this.analyserUnavailable = true;
    }
  }

  /** Current loudness bands, sampled on demand by the render loop. */
  getSpectrum(): SpectrumLevels {
    const analyser = this.analyser;
    const data = this.spectrumData;
    const context = this.audioContext;
    if (!analyser || !data || !context) return SILENT_SPECTRUM;

    analyser.getByteFrequencyData(data);
    const binHz = context.sampleRate / 2 / data.length;
    const bin = (hz: number): number =>
      Math.max(0, Math.min(data.length - 1, Math.round(hz / binHz)));

    const bass = averageBand(data, bin(30), bin(160));
    const mid = averageBand(data, bin(160), bin(2000));
    const treble = averageBand(data, bin(2000), bin(8000));
    const level = Math.min(1, bass * 0.45 + mid * 0.4 + treble * 0.15);
    return { level, bass, mid, treble };
  }

  async load(url: string): Promise<number> {
    if (this.destroyed) throw new AudioServiceError('Playback has been disposed.', 'NO_SOURCE');
    this.playPromise = null;
    this.error = null;
    this.status = 'loading';
    this.notify();

    this.audio.pause();
    this.audio.src = url;
    this.audio.load();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(false), 20_000);
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        this.audio.removeEventListener('canplay', onReady);
        this.audio.removeEventListener('error', onFailure);
        this.loadedMetadataHandler = null;
        this.loadedErrorHandler = null;
      };
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        if (ok) resolve();
        else
          reject(
            new AudioServiceError(
              this.error ?? 'The audio took too long to load. The file may be damaged or unavailable.',
              this.error ? 'LOAD_FAILED' : 'DECODE_FAILED',
            ),
          );
      };
      const onReady = () => {
        if (this.audio.readyState >= 1) finish(true);
      };
      const onFailure = () => finish(false);
      this.loadedMetadataHandler = onReady;
      this.loadedErrorHandler = onFailure;
      this.audio.addEventListener('loadedmetadata', onReady);
      this.audio.addEventListener('canplay', onReady);
      this.audio.addEventListener('error', onFailure);
      if (this.audio.readyState >= 1) finish(true);
    });

    if (this.error) {
      throw new AudioServiceError(this.error, 'LOAD_FAILED');
    }
    if (this.duration <= 0) {
      throw new AudioServiceError(
        'The audio file has no readable duration. It may be corrupt or unsupported.',
        'DECODE_FAILED',
      );
    }

    this.status = 'ready';
    this.notify();
    return this.duration;
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    if (!this.hasSource) throw new AudioServiceError('No audio is loaded.', 'NO_SOURCE');
    if (!this.audio.paused && !this.audio.ended) return;
    if (this.playPromise) return this.playPromise;

    if (this.audio.ended) {
      this.audio.currentTime = 0;
    }

    await this.ensureAnalyser();
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume().catch(() => undefined);
    }

    this.error = null;
    const promise = this.audio.play();
    this.playPromise = promise;
    try {
      await promise;
      if (this.status !== 'error') this.setStatus('playing');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      const message =
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Playback was blocked by Windows. Press Space or click once inside the window to begin.'
          : 'Playback could not start. The audio file may be unavailable.';
      this.setStatus('error', message);
      throw new AudioServiceError(message, 'PLAY_FAILED');
    } finally {
      this.playPromise = null;
    }
  }

  pause(): void {
    if (!this.audio.paused) this.audio.pause();
    else if (this.status !== 'ended') this.setStatus('paused');
  }

  async toggle(): Promise<void> {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  seekTo(seconds: number): number {
    const target = Math.min(this.duration || Number.MAX_VALUE, Math.max(0, seconds));
    if (!Number.isFinite(target)) return this.currentTime;
    try {
      this.audio.currentTime = target;
      if (this.audio.ended && target < (this.duration || Number.MAX_VALUE)) {
        this.status = 'paused';
        this.notify();
      }
    } catch {
      // A file that disappears mid-playback can reject seeking; the error event
      // will surface the failure separately.
    }
    return this.currentTime;
  }

  seekBy(deltaSeconds: number): number {
    return this.seekTo(this.currentTime + deltaSeconds);
  }

  setVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, volume));
    this.audio.volume = next;
    if (next > 0 && this.audio.muted) this.audio.muted = false;
    this.notify();
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
    this.notify();
  }

  unload(): void {
    this.playPromise = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.status = 'idle';
    this.error = null;
    this.notify();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadedMetadataHandler = null;
    this.loadedErrorHandler = null;
    this.audio.removeEventListener('loadedmetadata', this.onMetadata);
    this.audio.removeEventListener('durationchange', this.onMetadata);
    this.audio.removeEventListener('play', this.onPlay);
    this.audio.removeEventListener('pause', this.onPause);
    this.audio.removeEventListener('ended', this.onEnded);
    this.audio.removeEventListener('error', this.onError);
    this.audio.removeEventListener('canplay', this.onCanPlay);
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.listeners.clear();
    this.status = 'idle';
    this.analyser = null;
    this.spectrumData = null;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }
}
