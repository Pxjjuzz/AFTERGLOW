import { parseLrc } from '../../src/features/lyrics/lrcParser';
import type { AutoLyricsPayload } from '../../shared/ipc';
import type { LyricsLookupResult, LyricsProvider, LyricsQuery } from './types';

const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
const DEFAULT_USER_AGENT =
  'AfterGlowV2/2.0.0 (Electron ambient lyrics overlay; https://github.com/Pxjjuzz/AFTERGLOW)';

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface ScoredCandidate {
  candidate: LrclibRecord;
  score: number;
}

const VERSION_FLAGS: Array<[RegExp, string]> = [
  [/\bremaster(ed)?\b/i, 'remaster'],
  [/\blive\b/i, 'live'],
  [/\bacoustic\b/i, 'acoustic'],
  [/\bunplugged\b/i, 'acoustic'],
  [/\bremix\b/i, 'remix'],
  [/\bmix\b/i, 'remix'],
  [/\bradio edit\b/i, 'edit'],
  [/\bextended\b/i, 'extended'],
  [/\binstrumental\b/i, 'instrumental'],
  [/\bkaraoke\b/i, 'karaoke'],
  [/\bdemo\b/i, 'demo'],
  [/\bcover\b/i, 'cover'],
  [/\bsped up\b/i, 'sped-up'],
  [/\bslowed\b/i, 'slowed'],
  [/\bnightcore\b/i, 'nightcore'],
  [/\bexplicit\b/i, 'explicit'],
  [/\bclean\b/i, 'clean'],
];

const VERSION_TAIL =
  /\b(remaster(ed)?|live|acoustic|unplugged|remix|radio edit|extended|instrumental|karaoke|demo|cover|sped up|slowed|nightcore|deluxe|bonus|explicit|clean|mono|stereo)\b/i;

export function normalizeForMatch(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized || value.trim().toLowerCase();
}

/** Title without version qualifiers, used as a secondary match key. */
export function baseTitle(title: string): string {
  let out = title.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const parts = out.split(/\s+-\s+/);
  if (parts.length > 1) {
    const tail = parts.slice(1).join(' - ');
    if (VERSION_TAIL.test(tail)) out = parts[0] ?? out;
  }
  out = out.replace(/\s+\b(feat\.?|featuring|ft\.?)\s+.*$/i, ' ');
  return normalizeForMatch(out) || normalizeForMatch(title);
}

export function versionFlags(value: string): Set<string> {
  const flags = new Set<string>();
  for (const [pattern, flag] of VERSION_FLAGS) {
    if (pattern.test(value)) flags.add(flag);
  }
  return flags;
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function titleScore(queryTitle: string, candidateTitle: string): number {
  const left = normalizeForMatch(queryTitle);
  const right = normalizeForMatch(candidateTitle);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBase = baseTitle(queryTitle);
  const rightBase = baseTitle(candidateTitle);
  if (leftBase && leftBase === rightBase) return 0.95;
  if (left.includes(right) || right.includes(left)) return 0.82;
  const overlap = tokenOverlap(leftBase, rightBase);
  if (overlap >= 0.6) return 0.62 + overlap * 0.22;
  return overlap * 0.5;
}

function artistScore(queryArtist: string, candidateArtist: string): number | null {
  const left = normalizeForMatch(queryArtist);
  if (!left) return null;
  const right = normalizeForMatch(candidateArtist);
  if (!right) return 0.4;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  return tokenOverlap(left, right) * 0.8;
}

function durationScore(queryDuration: number, candidateDuration: number): number | null {
  if (queryDuration <= 0 || candidateDuration <= 0) return null;
  const diff = Math.abs(queryDuration - candidateDuration);
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.9;
  if (diff <= 10) return 0.7;
  if (diff <= 20) return 0.42;
  if (diff <= 40) return 0.16;
  return 0;
}

/**
 * Similarity score in 0..1. The weights favour the title, then artist, then
 * duration. Version qualifiers (live, remix, instrumental...) reduce a match so
 * a studio track is not silently paired with a live recording.
 */
export function scoreCandidate(query: LyricsQuery, candidate: LrclibRecord): number {
  const title = titleScore(query.title, candidate.trackName);
  const artist = artistScore(query.artist, candidate.artistName);
  const duration = durationScore(query.duration, candidate.duration);

  let weightSum = 0;
  let total = 0;
  const titleWeight = artist === null ? 0.7 : 0.52;
  const durationWeight = artist === null ? 0.3 : 0.2;
  const artistWeight = artist === null ? 0 : 0.28;

  total += title * titleWeight;
  weightSum += titleWeight;
  if (artist !== null) {
    total += artist * artistWeight;
    weightSum += artistWeight;
  }
  if (duration !== null) {
    total += duration * durationWeight;
    weightSum += durationWeight;
  }

  let score = weightSum > 0 ? total / weightSum : 0;

  const queryFlags = versionFlags(query.title);
  const candidateFlags = versionFlags(candidate.trackName);
  for (const flag of queryFlags) {
    if (!candidateFlags.has(flag)) score -= 0.09;
  }
  for (const flag of candidateFlags) {
    if (!queryFlags.has(flag)) score -= 0.07;
  }

  const queryAlbum = normalizeForMatch(query.album);
  const candidateAlbum = normalizeForMatch(candidate.albumName);
  if (queryAlbum && candidateAlbum && queryAlbum === candidateAlbum) score += 0.02;

  return Math.min(1, Math.max(0, score));
}

/** Only timestamped or explicitly instrumental candidates are usable here. */
export function pickBestCandidate(
  query: LyricsQuery,
  candidates: readonly LrclibRecord[],
  minScore = 0.6,
): ScoredCandidate | null {
  const scored = candidates
    .filter(
      (candidate) =>
        Boolean(candidate.syncedLyrics && candidate.syncedLyrics.trim()) || candidate.instrumental,
    )
    .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => {
      const syncedA = a.candidate.syncedLyrics ? 1 : 0;
      const syncedB = b.candidate.syncedLyrics ? 1 : 0;
      if (syncedA !== syncedB) return syncedB - syncedA;
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(query.duration - a.candidate.duration) -
        Math.abs(query.duration - b.candidate.duration);
    });
  return scored[0] ?? null;
}

export function validateSyncedLyrics(text: string): boolean {
  const parsed = parseLrc(text);
  return parsed.ok && parsed.lyrics.lines.length > 0;
}

export class LrclibError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'LrclibError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LrclibClientOptions {
  fetchImpl?: typeof globalThis.fetch;
  userAgent?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export class LrclibClient implements LyricsProvider {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private lastRequestAt = 0;

  constructor(options: LrclibClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? 450;
    this.timeoutMs = options.timeoutMs ?? 9000;
    this.retries = options.retries ?? 2;
  }

  async search(query: LyricsQuery): Promise<LrclibRecord[]> {
    const params = new URLSearchParams();
    params.set('track_name', query.title);
    if (query.artist) params.set('artist_name', query.artist);
    if (query.album) params.set('album_name', query.album);
    const payload = await this.requestJson(`${LRCLIB_SEARCH_URL}?${params.toString()}`);
    if (!Array.isArray(payload)) return [];
    return payload
      .map((entry) => this.asRecord(entry))
      .filter((entry): entry is LrclibRecord => entry !== null);
  }

  async find(query: LyricsQuery): Promise<LyricsLookupResult> {
    if (!query.title.trim()) {
      return {
        status: 'not-found',
        message: 'The player did not expose a track title, so lyrics cannot be matched.',
      };
    }

    let records: LrclibRecord[];
    try {
      records = await this.search(query);
    } catch (error) {
      return {
        status: 'error',
        message:
          error instanceof Error
            ? `LRCLIB lookup failed: ${error.message}`
            : 'LRCLIB lookup failed.',
      };
    }

    if (records.length === 0) {
      return {
        status: 'not-found',
        message: 'No LRCLIB entry matched this track. Import an .lrc file to use it.',
      };
    }

    const best = pickBestCandidate(query, records);
    if (!best) {
      return {
        status: 'not-found',
        message: 'LRCLIB has no confidently matching timestamped lyrics for this track.',
      };
    }

    if (best.candidate.instrumental) {
      return {
        status: 'instrumental',
        message: 'LRCLIB marks this track as instrumental, so there are no lyrics to show.',
      };
    }

    const lrc = best.candidate.syncedLyrics?.trim() ?? '';
    if (!validateSyncedLyrics(lrc)) {
      return {
        status: 'not-found',
        message: 'The LRCLIB match had no usable timestamped lyrics.',
      };
    }

    const payload: AutoLyricsPayload = {
      lrc,
      provider: 'lrclib',
      matchedTitle: best.candidate.trackName,
      matchedArtist: best.candidate.artistName,
      matchedDuration: best.candidate.duration,
      score: Math.round(best.score * 1000) / 1000,
      instrumental: false,
    };
    return { status: 'ready', payload };
  }

  private asRecord(raw: unknown): LrclibRecord | null {
    if (raw === null || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.trackName !== 'string' || typeof record.artistName !== 'string') return null;
    const duration = typeof record.duration === 'number' && Number.isFinite(record.duration)
      ? record.duration
      : 0;
    return {
      id: typeof record.id === 'number' ? record.id : 0,
      trackName: record.trackName,
      artistName: record.artistName,
      albumName: typeof record.albumName === 'string' ? record.albumName : '',
      duration,
      instrumental: record.instrumental === true,
      plainLyrics: typeof record.plainLyrics === 'string' ? record.plainLyrics : null,
      syncedLyrics: typeof record.syncedLyrics === 'string' ? record.syncedLyrics : null,
    };
  }

  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async requestJson(url: string): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      await this.waitForSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (response.status === 404) return [];
        if (response.status === 429 || response.status >= 500) {
          lastError = new LrclibError(
            `LRCLIB is busy (HTTP ${response.status}).`,
            response.status,
          );
          if (attempt < this.retries) await sleep(600 * (attempt + 1));
          continue;
        }
        if (!response.ok) {
          throw new LrclibError(`LRCLIB returned HTTP ${response.status}.`, response.status);
        }
        return (await response.json()) as unknown;
      } catch (error) {
        lastError = controller.signal.aborted
          ? new LrclibError('LRCLIB request timed out.')
          : error;
        if (attempt < this.retries) await sleep(600 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new LrclibError('LRCLIB request failed.');
  }
}
