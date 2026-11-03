import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type SelectedFile } from '@shared/ipc';
import { canEnterExperience, useAppStore } from '@/stores/appStore';
import { parseLrc } from '@/features/lyrics/lrcParser';

const audio: SelectedFile = {
  path: 'C:\\music\\track.wav',
  name: 'track.wav',
  kind: 'audio',
  extension: '.wav',
  size: 1000,
};

const lyricsFile: SelectedFile = {
  path: 'C:\\music\\track.lrc',
  name: 'track.lrc',
  kind: 'lyrics',
  extension: '.lrc',
  size: 100,
};

const parsed = parseLrc('[00:01.00]Hello');
if (!parsed.ok) throw new Error(parsed.error.message);
const lyrics = parsed.lyrics;

beforeEach(() => {
  useAppStore.setState({
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
  });
});

describe('appStore', () => {
  it('requires both files and parsed lyrics before entering', () => {
    const store = useAppStore.getState();
    expect(canEnterExperience(store)).toBe(false);
    store.setAudioFile(audio);
    expect(canEnterExperience(useAppStore.getState())).toBe(false);
    store.setLyricsFile(lyricsFile, lyrics);
    expect(canEnterExperience(useAppStore.getState())).toBe(true);
  });

  it('clears file errors when a replacement file is accepted', () => {
    useAppStore.getState().setAudioError('Broken file');
    useAppStore.getState().setAudioFile(audio);
    expect(useAppStore.getState().audioError).toBeNull();

    useAppStore.getState().setLyricsError('Bad lyrics');
    useAppStore.getState().setLyricsFile(lyricsFile, lyrics);
    expect(useAppStore.getState().lyricsError).toBeNull();
  });

  it('moves through entering, experience, failure, and exit', () => {
    useAppStore.getState().setAudioFile(audio);
    useAppStore.getState().setLyricsFile(lyricsFile, lyrics);
    useAppStore.getState().beginEntering();
    expect(useAppStore.getState().isEntering).toBe(true);
    expect(canEnterExperience(useAppStore.getState())).toBe(false);
    useAppStore.getState().enterExperience();
    expect(useAppStore.getState().phase).toBe('experience');
    useAppStore.getState().exitExperience();
    expect(useAppStore.getState().phase).toBe('setup');
    expect(useAppStore.getState().isEntering).toBe(false);

    useAppStore.getState().failEntrance('Could not start');
    expect(useAppStore.getState().experienceError).toBe('Could not start');
    expect(useAppStore.getState().audioFile).toEqual(audio);
  });

  it('updates settings without dropping unknown fields', () => {
    useAppStore.getState().updateSettings({ offsetMs: 250, intensity: 0.8 });
    expect(useAppStore.getState().settings.offsetMs).toBe(250);
    expect(useAppStore.getState().settings.wordReveal).toBe(DEFAULT_SETTINGS.wordReveal);
  });

  it('applies persisted settings and recent files atomically', () => {
    useAppStore.getState().applySettingsSnapshot({
      settings: { ...DEFAULT_SETTINGS, constellationStyle: 'kinetic' },
      recent: {
        audio: { ...audio, lastOpenedAt: 123 },
        lyrics: null,
      },
    });
    const state = useAppStore.getState();
    expect(state.settingsReady).toBe(true);
    expect(state.settings.constellationStyle).toBe('kinetic');
    expect(state.recent.audio?.lastOpenedAt).toBe(123);
    expect(state.audioFile).toBeNull();
  });

  it('clears all transient errors and notices', () => {
    useAppStore.getState().setAudioError('a');
    useAppStore.getState().setLyricsError('b');
    useAppStore.getState().setExperienceError('c');
    useAppStore.getState().setNotice('d');
    useAppStore.getState().clearErrors();
    const state = useAppStore.getState();
    expect([state.audioError, state.lyricsError, state.experienceError, state.notice]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});
