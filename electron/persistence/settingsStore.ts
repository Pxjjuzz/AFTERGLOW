import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import type { Database, SqlJsStatic } from 'sql.js';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type FileKind,
  type RecentFile,
  type SelectedFile,
  type SettingsSnapshot,
  type WordRevealMode,
} from '../../shared/ipc';

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeSettings(input: unknown): AppSettings {
  const record =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const reducedMotion =
    record.reducedMotion === 'on' || record.reducedMotion === 'off' || record.reducedMotion === 'auto'
      ? record.reducedMotion
      : DEFAULT_SETTINGS.reducedMotion;
  const wordReveal: WordRevealMode =
    record.wordReveal === 'even' || record.wordReveal === 'sequential'
      ? record.wordReveal
      : DEFAULT_SETTINGS.wordReveal;
  const constellationStyle =
    record.constellationStyle === 'starfield' ||
    record.constellationStyle === 'kinetic' ||
    record.constellationStyle === 'constellation'
      ? record.constellationStyle
      : DEFAULT_SETTINGS.constellationStyle;

  return {
    offsetMs: clamp(Math.round(Number(record.offsetMs) || 0), -5000, 5000),
    intensity: clamp(Number(record.intensity) || DEFAULT_SETTINGS.intensity, 0.35, 1.5),
    reducedMotion,
    temporaryControls:
      typeof record.temporaryControls === 'boolean'
        ? record.temporaryControls
        : DEFAULT_SETTINGS.temporaryControls,
    wordReveal,
    constellationStyle,
  };
}

export function sanitizeSettingsPatch(input: unknown): Partial<AppSettings> {
  if (input === null || typeof input !== 'object') return {};
  const record = input as Record<string, unknown>;
  const patch: Partial<AppSettings> = {};

  if ('offsetMs' in record) {
    patch.offsetMs = clamp(Math.round(Number(record.offsetMs) || 0), -5000, 5000);
  }
  if ('intensity' in record) {
    patch.intensity = clamp(
      Number(record.intensity) || DEFAULT_SETTINGS.intensity,
      0.35,
      1.5,
    );
  }
  if (record.reducedMotion === 'on' || record.reducedMotion === 'off' || record.reducedMotion === 'auto') {
    patch.reducedMotion = record.reducedMotion;
  }
  if (typeof record.temporaryControls === 'boolean') {
    patch.temporaryControls = record.temporaryControls;
  }
  if (record.wordReveal === 'even' || record.wordReveal === 'sequential') {
    patch.wordReveal = record.wordReveal;
  }
  if (
    record.constellationStyle === 'constellation' ||
    record.constellationStyle === 'starfield' ||
    record.constellationStyle === 'kinetic'
  ) {
    patch.constellationStyle = record.constellationStyle;
  }
  return patch;
}

export class SettingsStore {
  private db: Database | null = null;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private recent: Record<FileKind, RecentFile | null> = { audio: null, lyrics: null };
  private readonly filePath: string;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let SQL: SqlJsStatic;
    try {
      SQL = await initSqlJs();
    } catch (error) {
      console.error('[afterglow] SQLite runtime failed to initialise', error);
      return;
    }

    let existing: Uint8Array | null = null;
    try {
      existing = await readFile(this.filePath);
    } catch {
      existing = null;
    }

    try {
      this.db = existing ? new SQL.Database(existing) : new SQL.Database();
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recent_files (
          kind TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          size INTEGER NOT NULL,
          last_opened_at INTEGER NOT NULL
        );
      `);
      this.loadIntoMemory();
    } catch (error) {
      console.error('[afterglow] settings database was unreadable; starting fresh', error);
      if (existing) {
        try {
          await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
          // Best effort only.
        }
      }
      this.db = new SQL.Database();
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recent_files (
          kind TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
          size INTEGER NOT NULL, last_opened_at INTEGER NOT NULL
        );
      `);
      this.settings = { ...DEFAULT_SETTINGS };
      this.recent = { audio: null, lyrics: null };
      await this.persist();
    }
  }

  private loadIntoMemory(): void {
    if (!this.db) return;
    const settingRows = this.db.exec('SELECT key, value FROM settings')[0];
    if (settingRows) {
      const [keyColumn, valueColumn] = settingRows.columns;
      if (keyColumn && valueColumn) {
        const values = Object.fromEntries(
          settingRows.values.map((row) => [String(row[0]), String(row[1])]),
        );
        this.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...values });
      }
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
    }

    const recentResult = this.db.exec(
      'SELECT kind, path, name, size, last_opened_at FROM recent_files',
    )[0];
    this.recent = { audio: null, lyrics: null };
    if (recentResult) {
      for (const row of recentResult.values) {
        const [kind, filePath, name, size, lastOpenedAt] = row;
        if (kind !== 'audio' && kind !== 'lyrics') continue;
        this.recent[kind] = {
          kind,
          path: String(filePath),
          name: String(name),
          size: Number(size),
          lastOpenedAt: Number(lastOpenedAt),
        };
      }
    }
  }

  getSnapshot(): SettingsSnapshot {
    return {
      settings: { ...this.settings },
      recent: {
        audio: this.recent.audio ? { ...this.recent.audio } : null,
        lyrics: this.recent.lyrics ? { ...this.recent.lyrics } : null,
      },
    };
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.dirty = true;
    await this.persist();
    return this.getSnapshot();
  }

  async rememberFile(file: SelectedFile): Promise<void> {
    this.recent[file.kind] = {
      kind: file.kind,
      path: file.path,
      name: file.name,
      size: file.size,
      lastOpenedAt: Date.now(),
    };
    this.dirty = true;
    await this.persist();
  }

  async forgetFile(kind: FileKind): Promise<void> {
    this.recent[kind] = null;
    this.dirty = true;
    await this.persist();
  }

  async persist(): Promise<void> {
    if (!this.db || !this.dirty) return;
    if (this.db) {
      for (const key of SETTINGS_KEYS) {
        this.db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [key, String(this.settings[key])],
        );
      }
      for (const kind of ['audio', 'lyrics'] as const) {
        const recent = this.recent[kind];
        if (recent) {
          this.db.run(
            `INSERT INTO recent_files (kind, path, name, size, last_opened_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(kind) DO UPDATE SET
               path = excluded.path,
               name = excluded.name,
               size = excluded.size,
               last_opened_at = excluded.last_opened_at`,
            [recent.kind, recent.path, recent.name, recent.size, recent.lastOpenedAt],
          );
        } else {
          this.db.run('DELETE FROM recent_files WHERE kind = ?', [kind]);
        }
      }
    }

    const bytes = this.db.export();
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, bytes);
    await rename(tempPath, this.filePath);
    this.dirty = false;
  }

  close(): void {
    if (!this.db) return;
    try {
      if (this.dirty) {
        const bytes = this.db.export();
        mkdirSync(path.dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, bytes);
        this.dirty = false;
      }
    } catch (error) {
      console.error('[afterglow] could not persist settings on shutdown', error);
    }
    this.db.close();
    this.db = null;
  }
}
