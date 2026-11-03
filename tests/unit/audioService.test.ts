import { describe, expect, it } from 'vitest';
import { AudioService } from '@/services/audio/AudioService';

class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = 0;
  paused = true;
  ended = false;
  volume = 1;
  muted = false;
  src = '';
  currentSrc = '';
  readyState = 0;
  preload = '';
  error: MediaError | null = null;

  load(): void {
    if (this.src) {
      this.duration = 12;
      this.readyState = 4;
      this.currentSrc = this.src;
      this.dispatchEvent(new Event('loadedmetadata'));
    }
  }

  play(): Promise<void> {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }

  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
      this.currentSrc = '';
      this.readyState = 0;
      this.duration = 0;
      this.currentTime = 0;
    }
  }
}

function makeService() {
  const audio = new FakeAudio();
  const service = new AudioService(audio as unknown as HTMLAudioElement);
  const snapshots: string[] = [];
  const unsubscribe = service.subscribe((snapshot) => snapshots.push(snapshot.status));
  return { audio, service, snapshots, unsubscribe };
}

describe('AudioService', () => {
  it('loads metadata and reports the authoritative duration', async () => {
    const { service, snapshots, unsubscribe } = makeService();
    const duration = await service.load('afterglow-media://track/test');
    expect(duration).toBe(12);
    expect(service.duration).toBe(12);
    expect(service.hasSource).toBe(true);
    expect(snapshots).toContain('loading');
    expect(snapshots).toContain('ready');
    unsubscribe();
    service.destroy();
  });

  it('plays, pauses, toggles, and emits snapshots', async () => {
    const { service, unsubscribe } = makeService();
    await service.load('afterglow-media://track/test');
    await service.play();
    expect(service.isPlaying).toBe(true);
    service.pause();
    expect(service.isPlaying).toBe(false);
    await service.toggle();
    expect(service.isPlaying).toBe(true);
    unsubscribe();
    service.destroy();
  });

  it('seeks within bounds and supports relative seeking', async () => {
    const { service, unsubscribe } = makeService();
    await service.load('afterglow-media://track/test');
    expect(service.seekTo(5)).toBe(5);
    expect(service.seekBy(3)).toBe(8);
    expect(service.seekBy(100)).toBe(12);
    expect(service.seekBy(-100)).toBe(0);
    unsubscribe();
    service.destroy();
  });

  it('controls volume and mute', async () => {
    const { service, unsubscribe } = makeService();
    service.setVolume(0.4);
    expect(service.getSnapshot().volume).toBe(0.4);
    service.setMuted(true);
    expect(service.getSnapshot().muted).toBe(true);
    service.setVolume(0.8);
    expect(service.getSnapshot().muted).toBe(false);
    unsubscribe();
    service.destroy();
  });

  it('unloads back to idle without a source', async () => {
    const { service, audio, unsubscribe } = makeService();
    await service.load('afterglow-media://track/test');
    service.unload();
    expect(service.getSnapshot().status).toBe('idle');
    expect(service.hasSource).toBe(false);
    expect(audio.src).toBe('');
    unsubscribe();
    service.destroy();
  });
});
