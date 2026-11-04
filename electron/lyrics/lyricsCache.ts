import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutoLyricsPayload } from '../../shared/ipc';
import { normalizeForMatch } from './lrclib';
import type { LyricsQuery } from './types';

interface CacheEntry {
  payload: AutoLyricsPayload;
  storedAt: number;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const MAX_ENTRIES = 400;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/** Stable cache key: title + artist + a five-second duration bucket. */
export function cacheKeyFor(query: LyricsQuery): string {
  const title = normalizeForMatch(query.title);
  const artist = normalizeForMatch(query.artist);
  const bucket = query.duration > 0 ? Math.round(query.duration / 5) * 5 : 0;
  return `${title}|${artist}|${bucket}`;
}

export class LyricsCache {
  private readonly filePath: string;
  private readonly now: () => number;
  private entries: Record<string, CacheEntry> = {};
  private loaded = false;

  constructor(filePath: string, now: () => number = Date.now) {
    this.filePath = filePath;
    this.now = now;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CacheFile>;
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.entries = parsed.entries;
      }
    } catch {
      this.entries = {};
    }
    this.loaded = true;
  }

  get(query: LyricsQuery): AutoLyricsPayload | null {
    const key = cacheKeyFor(query);
    const entry = this.entries[key];
    if (!entry) return null;
    if (this.now() - entry.storedAt > MAX_AGE_MS) {
      delete this.entries[key];
      return null;
    }
    return entry.payload;
  }

  async set(query: LyricsQuery, payload: AutoLyricsPayload): Promise<void> {
    if (!this.loaded) await this.init();
    this.entries[cacheKeyFor(query)] = { payload, storedAt: this.now() };
    const keys = Object.keys(this.entries);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (this.entries[a]?.storedAt ?? 0) - (this.entries[b]?.storedAt ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete this.entries[key]);
    }
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries = {};
    await this.persist();
  }

  private async persist(): Promise<void> {
    const temp = `${this.filePath}.tmp`;
    const data: CacheFile = { version: 1, entries: this.entries };
    await writeFile(temp, JSON.stringify(data), 'utf8');
    await rename(temp, this.filePath);
  }
}
