import { create } from 'zustand';
import type { AudioSnapshot, AudioStatus } from '@/services/audio/AudioService';

export interface PlaybackState {
  status: AudioStatus;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  isPlaying: boolean;
  applySnapshot(snapshot: AudioSnapshot): void;
  reset(): void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  status: 'idle',
  duration: 0,
  volume: 1,
  muted: false,
  error: null,
  isPlaying: false,
  applySnapshot: (snapshot) =>
    set({
      status: snapshot.status,
      duration: snapshot.duration,
      volume: snapshot.volume,
      muted: snapshot.muted,
      error: snapshot.error,
      isPlaying: snapshot.status === 'playing',
    }),
  reset: () =>
    set({
      status: 'idle',
      duration: 0,
      volume: 1,
      muted: false,
      error: null,
      isPlaying: false,
    }),
}));
