import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AutoSettingsStore,
  DEFAULT_AUTO_SETTINGS,
  sanitizeAutoSettings,
  sanitizeAutoSettingsPatch,
} from '../../electron/auto/autoSettings';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'afterglowv2-auto-settings-'));
  roots.push(root);
  return root;
}

describe('sanitizeAutoSettings', () => {
  it('returns safe defaults for hostile input', () => {
    const settings = sanitizeAutoSettings({
      enabled: 'yes',
      monitoredPlayer: 42,
      entryDelayMs: -5000,
      exitDelayMs: 9999999,
      pauseDelayMs: Number.NaN,
      pauseBehavior: 'explode',
      onlineLyrics: 'no',
      captureAudio: null,
      overlayControls: 0,
    });
    expect(settings).toEqual({
      ...DEFAULT_AUTO_SETTINGS,
      entryDelayMs: 0,
      exitDelayMs: 120_000,
    });
  });

  it('trims and caps the monitored player identifier', () => {
    const settings = sanitizeAutoSettings({
      monitoredPlayer: `  ${'a'.repeat(400)}  `,
    });
    expect(settings.monitoredPlayer).toHaveLength(256);
  });

  it('accepts valid values and rounds delays to whole milliseconds', () => {
    const settings = sanitizeAutoSettings({
      enabled: false,
      monitoredPlayer: 'Spotify.exe',
      entryDelayMs: 1234.6,
      exitDelayMs: 4321.2,
      pauseDelayMs: 999,
      pauseBehavior: 'hide',
      onlineLyrics: false,
      captureAudio: false,
      overlayControls: false,
    });
    expect(settings).toEqual({
      enabled: false,
      monitoredPlayer: 'Spotify.exe',
      entryDelayMs: 1235,
      exitDelayMs: 4321,
      pauseDelayMs: 999,
      pauseBehavior: 'hide',
      onlineLyrics: false,
      captureAudio: false,
      overlayControls: false,
    });
  });
});

describe('sanitizeAutoSettingsPatch', () => {
  it('only keeps known keys and rejects malformed values', () => {
    expect(sanitizeAutoSettingsPatch(null)).toEqual({});
    expect(
      sanitizeAutoSettingsPatch({
        entryDelayMs: 'soon',
        pauseBehavior: 'vanish',
        unknown: true,
      }),
    ).toEqual({ entryDelayMs: DEFAULT_AUTO_SETTINGS.entryDelayMs, pauseBehavior: 'keep' });
  });

  it('preserves valid partial updates', () => {
    expect(
      sanitizeAutoSettingsPatch({
        enabled: false,
        monitoredPlayer: '  MusicBee.exe  ',
        pauseBehavior: 'hide',
        captureAudio: false,
      }),
    ).toEqual({
      enabled: false,
      monitoredPlayer: 'MusicBee.exe',
      pauseBehavior: 'hide',
      captureAudio: false,
    });
  });
});

describe('AutoSettingsStore', () => {
  it('creates a defaults file when none exists and restores saved values', async () => {
    const root = await makeRoot();
    const filePath = path.join(root, 'auto-settings.json');
    const store = new AutoSettingsStore(filePath);
    await store.init();
    expect(store.get()).toEqual(DEFAULT_AUTO_SETTINGS);

    await store.save({ entryDelayMs: 2500, pauseBehavior: 'hide' });
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(raw.entryDelayMs).toBe(2500);
    expect(raw.pauseBehavior).toBe('hide');

    const reopened = new AutoSettingsStore(filePath);
    await reopened.init();
    expect(reopened.get().entryDelayMs).toBe(2500);
    expect(reopened.get().pauseBehavior).toBe('hide');
  });

  it('recovers from a corrupt file instead of crashing', async () => {
    const root = await makeRoot();
    const filePath = path.join(root, 'auto-settings.json');
    await writeFile(filePath, '{not json', 'utf8');
    const store = new AutoSettingsStore(filePath);
    await store.init();
    expect(store.get()).toEqual(DEFAULT_AUTO_SETTINGS);

    const files = await readdir(root);
    expect(files.some((name) => name.startsWith('auto-settings.json.corrupt-'))).toBe(true);
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(raw.entryDelayMs).toBe(DEFAULT_AUTO_SETTINGS.entryDelayMs);
  });

  it('does not expose its mutable settings object', async () => {
    const root = await makeRoot();
    const store = new AutoSettingsStore(path.join(root, 'auto-settings.json'));
    await store.init();
    const first = store.get();
    first.entryDelayMs = 1;
    expect(store.get().entryDelayMs).toBe(DEFAULT_AUTO_SETTINGS.entryDelayMs);
  });
});
