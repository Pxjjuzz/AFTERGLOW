import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type SelectedFile } from '@shared/ipc';
import { SettingsStore, sanitizeSettings, sanitizeSettingsPatch } from '../../electron/persistence/settingsStore';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeStore(): Promise<{ store: SettingsStore; filePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'afterglow-settings-'));
  roots.push(root);
  const filePath = path.join(root, 'data', 'afterglow.sqlite');
  const store = new SettingsStore(filePath);
  await store.init();
  return { store, filePath };
}

describe('sanitizeSettings', () => {
  it('coerces hostile values into the safe settings shape', () => {
    const settings = sanitizeSettings({
      offsetMs: 999999,
      intensity: -4,
      reducedMotion: 'sometimes',
      temporaryControls: 'yes',
      wordReveal: 'spiral',
      constellationStyle: 'explode',
    });
    expect(settings.offsetMs).toBe(5000);
    expect(settings.intensity).toBe(0.35);
    expect(settings.reducedMotion).toBe(DEFAULT_SETTINGS.reducedMotion);
    expect(settings.temporaryControls).toBe(DEFAULT_SETTINGS.temporaryControls);
    expect(settings.wordReveal).toBe(DEFAULT_SETTINGS.wordReveal);
    expect(settings.constellationStyle).toBe(DEFAULT_SETTINGS.constellationStyle);
  });

  it('ignores unknown or malformed patch keys', () => {
    expect(sanitizeSettingsPatch(null)).toEqual({});
    expect(sanitizeSettingsPatch({ offsetMs: 'abc', constellationStyle: 'nope' })).toEqual({
      offsetMs: 0,
    });
    expect(sanitizeSettingsPatch({ intensity: 1.2, temporaryControls: false })).toEqual({
      intensity: 1.2,
      temporaryControls: false,
    });
  });
});

describe('SettingsStore persistence', () => {
  it('creates a real SQLite file and restores settings and recents', async () => {
    const { store, filePath } = await makeStore();
    expect(store.getSnapshot()).toEqual({
      settings: DEFAULT_SETTINGS,
      recent: { audio: null, lyrics: null },
    });

    await store.saveSettings({ offsetMs: 420, constellationStyle: 'kinetic' });
    const file: SelectedFile = {
      path: 'C:\\music\\track.wav',
      name: 'track.wav',
      kind: 'audio',
      extension: '.wav',
      size: 1234,
    };
    await store.rememberFile(file);
    store.close();

    const bytes = await readFile(filePath);
    expect(bytes.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\u0000');

    const reopened = new SettingsStore(filePath);
    await reopened.init();
    const snapshot = reopened.getSnapshot();
    expect(snapshot.settings.offsetMs).toBe(420);
    expect(snapshot.settings.constellationStyle).toBe('kinetic');
    expect(snapshot.recent.audio?.path).toBe(file.path);
    expect(snapshot.recent.lyrics).toBeNull();

    await reopened.forgetFile('audio');
    expect(reopened.getSnapshot().recent.audio).toBeNull();
    reopened.close();
  });

  it('does not share mutable state with callers', async () => {
    const { store } = await makeStore();
    const snapshot = store.getSnapshot();
    snapshot.settings.offsetMs = 999;
    if (snapshot.recent.audio) snapshot.recent.audio.name = 'mutated';
    expect(store.getSnapshot().settings.offsetMs).toBe(0);
    store.close();
  });
});
