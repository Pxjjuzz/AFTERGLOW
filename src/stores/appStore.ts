import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RecentFile,
  type SelectedFile,
  type SettingsSnapshot,
} from '@shared/ipc';
import type { ParsedLyrics } from '@/features/lyrics/lrcParser';

export type AppPhase = 'setup' | 'experience';

export interface AppState {
  phase: AppPhase;
  audioFile: SelectedFile | null;
  lyricsFile: SelectedFile | null;
  lyrics: ParsedLyrics | null;
  settings: AppSettings;
  audioError: string | null;
  lyricsError: string | null;
  experienceError: string | null;
  notice: string | null;
  isEntering: boolean;
  settingsReady: boolean;
  recent: { audio: RecentFile | null; lyrics: RecentFile | null };

  setAudioFile(file: SelectedFile | null): void;
  setLyricsFile(file: SelectedFile | null, lyrics: ParsedLyrics | null): void;
  setAudioError(message: string | null): void;
  setLyricsError(message: string | null): void;
  setExperienceError(message: string | null): void;
  setNotice(message: string | null): void;
  updateSettings(patch: Partial<AppSettings>): void;
  applySettingsSnapshot(snapshot: SettingsSnapshot): void;
  beginEntering(): void;
  enterExperience(): void;
  failEntrance(message: string): void;
  exitExperience(): void;
  clearErrors(): void;
}

export const useAppStore = create<AppState>((set) => ({
  phase: 'setup',
  audioFile: null,
  lyricsFile: null,
  lyrics: null,
  settings: { ...DEFAULT_SETTINGS },
  audioError: null,
  lyricsError: null,
  experienceError: null,
  notice: null,
  isEntering: false,
  settingsReady: false,
  recent: { audio: null, lyrics: null },

  setAudioFile: (file) =>
    set({ audioFile: file, audioError: null, experienceError: null }),
  setLyricsFile: (file, lyrics) =>
    set({
      lyricsFile: file,
      lyrics,
      lyricsError: null,
      experienceError: null,
    }),
  setAudioError: (message) => set({ audioError: message }),
  setLyricsError: (message) => set({ lyricsError: message }),
  setExperienceError: (message) => set({ experienceError: message }),
  setNotice: (message) => set({ notice: message }),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  applySettingsSnapshot: (snapshot) =>
    set((state) => ({
      settings: snapshot.settings,
      recent: snapshot.recent,
      settingsReady: true,
      // Only fill files that the main process already validated and returned.
      audioFile: state.audioFile,
      lyricsFile: state.lyricsFile,
    })),
  beginEntering: () =>
    set({ isEntering: true, experienceError: null, notice: null }),
  enterExperience: () =>
    set({ phase: 'experience', isEntering: false, experienceError: null }),
  failEntrance: (message) =>
    set({ phase: 'setup', isEntering: false, experienceError: message }),
  exitExperience: () =>
    set({ phase: 'setup', isEntering: false, experienceError: null }),
  clearErrors: () =>
    set({
      audioError: null,
      lyricsError: null,
      experienceError: null,
      notice: null,
    }),
}));

export function canEnterExperience(state: AppState): boolean {
  return Boolean(
    state.audioFile &&
      state.lyricsFile &&
      state.lyrics &&
      state.lyrics.lines.length > 0 &&
      !state.isEntering,
  );
}

export const selectCanEnter = (state: AppState): boolean => canEnterExperience(state);
