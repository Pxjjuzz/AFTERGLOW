import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutoSettings } from '../../shared/ipc';

/**
 * AfterGlowV2 keeps its automatic-mode settings in a plain JSON file beside the
 * SQLite database the manual workflow already uses. Keeping the two stores
 * separate means the original AFTERGLOW database schema is never touched.
 */
export const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  enabled: true,
  monitoredPlayer: '',
  entryDelayMs: 4000,
  exitDelayMs: 8000,
  pauseDelayMs: 3000,
  pauseBehavior: 'keep',
  onlineLyrics: true,
  captureAudio: true,
  overlayControls: true,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeAutoSettings(input: unknown): AutoSettings {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const monitored =
    typeof record.monitoredPlayer === 'string' ? record.monitoredPlayer.trim().slice(0, 256) : '';

  return {
    enabled: asBoolean(record.enabled, DEFAULT_AUTO_SETTINGS.enabled),
    monitoredPlayer: monitored,
    entryDelayMs: clampNumber(
      record.entryDelayMs,
      DEFAULT_AUTO_SETTINGS.entryDelayMs,
      0,
      60_000,
    ),
    exitDelayMs: clampNumber(record.exitDelayMs, DEFAULT_AUTO_SETTINGS.exitDelayMs, 0, 120_000),
    pauseDelayMs: clampNumber(
      record.pauseDelayMs,
      DEFAULT_AUTO_SETTINGS.pauseDelayMs,
      0,
      60_000,
    ),
    pauseBehavior: record.pauseBehavior === 'hide' ? 'hide' : 'keep',
    onlineLyrics: asBoolean(record.onlineLyrics, DEFAULT_AUTO_SETTINGS.onlineLyrics),
    captureAudio: asBoolean(record.captureAudio, DEFAULT_AUTO_SETTINGS.captureAudio),
    overlayControls: asBoolean(record.overlayControls, DEFAULT_AUTO_SETTINGS.overlayControls),
  };
}

export function sanitizeAutoSettingsPatch(input: unknown): Partial<AutoSettings> {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const patch: Partial<AutoSettings> = {};
  if ('enabled' in record) patch.enabled = asBoolean(record.enabled, DEFAULT_AUTO_SETTINGS.enabled);
  if ('monitoredPlayer' in record) {
    patch.monitoredPlayer =
      typeof record.monitoredPlayer === 'string' ? record.monitoredPlayer.trim().slice(0, 256) : '';
  }
  if ('entryDelayMs' in record) {
    patch.entryDelayMs = clampNumber(
      record.entryDelayMs,
      DEFAULT_AUTO_SETTINGS.entryDelayMs,
      0,
      60_000,
    );
  }
  if ('exitDelayMs' in record) {
    patch.exitDelayMs = clampNumber(
      record.exitDelayMs,
      DEFAULT_AUTO_SETTINGS.exitDelayMs,
      0,
      120_000,
    );
  }
  if ('pauseDelayMs' in record) {
    patch.pauseDelayMs = clampNumber(
      record.pauseDelayMs,
      DEFAULT_AUTO_SETTINGS.pauseDelayMs,
      0,
      60_000,
    );
  }
  if ('pauseBehavior' in record) {
    patch.pauseBehavior = record.pauseBehavior === 'hide' ? 'hide' : 'keep';
  }
  if ('onlineLyrics' in record) {
    patch.onlineLyrics = asBoolean(record.onlineLyrics, DEFAULT_AUTO_SETTINGS.onlineLyrics);
  }
  if ('captureAudio' in record) {
    patch.captureAudio = asBoolean(record.captureAudio, DEFAULT_AUTO_SETTINGS.captureAudio);
  }
  if ('overlayControls' in record) {
    patch.overlayControls = asBoolean(
      record.overlayControls,
      DEFAULT_AUTO_SETTINGS.overlayControls,
    );
  }
  return patch;
}

export class AutoSettingsStore {
  private settings: AutoSettings = { ...DEFAULT_AUTO_SETTINGS };
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.settings = sanitizeAutoSettings(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn('[afterglowv2] automatic settings were unreadable; starting fresh', error);
        try {
          await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
          // Best effort only.
        }
      }
      this.settings = { ...DEFAULT_AUTO_SETTINGS };
      await this.persist();
    }
  }

  get(): AutoSettings {
    return { ...this.settings };
  }

  async save(patch: Partial<AutoSettings>): Promise<AutoSettings> {
    this.settings = sanitizeAutoSettings({ ...this.settings, ...patch });
    await this.persist();
    return this.get();
  }

  private async persist(): Promise<void> {
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.settings, null, 2), 'utf8');
    await rename(temp, this.filePath);
  }
}
