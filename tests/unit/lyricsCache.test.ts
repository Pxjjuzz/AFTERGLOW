import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AutoLyricsPayload } from '@shared/ipc';
import { LyricsCache, cacheKeyFor } from '../../electron/lyrics/lyricsCache';
import type { LyricsQuery } from '../../electron/lyrics/types';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeCache(now?: () => number): Promise<{ cache: LyricsCache; filePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'afterglowv2-lyrics-cache-'));
  roots.push(root);
  const filePath = path.join(root, 'cache', 'lyrics.json');
  const cache = new LyricsCache(filePath, now);
  await cache.init();
  return { cache, filePath };
}

const query: LyricsQuery = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 354,
};

const payload: AutoLyricsPayload = {
  lrc: '[00:00.00]Is this the real life?',
  provider: 'lrclib',
  matchedTitle: 'Bohemian Rhapsody',
  matchedArtist: 'Queen',
  matchedDuration: 354,
  score: 0.97,
  instrumental: false,
};

describe('cacheKeyFor', () => {
  it('normalizes text and buckets duration to five seconds', () => {
    expect(cacheKeyFor(query)).toBe('bohemian rhapsody|queen|355');
    expect(cacheKeyFor({ ...query, title: '  BOHEMIAN   RHAPSODY ', duration: 353 })).toBe(
      cacheKeyFor(query),
    );
    expect(cacheKeyFor({ ...query, duration: 0 })).toContain('|0');
  });
});

describe('LyricsCache', () => {
  it('stores, retrieves, and persists a payload', async () => {
    const { cache, filePath } = await makeCache();
    expect(cache.get(query)).toBeNull();
    await cache.set(query, payload);
    expect(cache.get(query)).toEqual(payload);

    const reopened = new LyricsCache(filePath);
    await reopened.init();
    expect(reopened.get(query)).toEqual(payload);
  });

  it('expires entries older than sixty days', async () => {
    let now = 1_000_000;
    const { cache } = await makeCache(() => now);
    await cache.set(query, payload);
    expect(cache.get(query)).not.toBeNull();

    now += 59 * 24 * 60 * 60 * 1000;
    expect(cache.get(query)).not.toBeNull();

    now += 2 * 24 * 60 * 60 * 1000;
    expect(cache.get(query)).toBeNull();
  });

  it('clears all entries and survives a corrupt cache file', async () => {
    const { cache, filePath } = await makeCache();
    await cache.set(query, payload);
    await cache.clear();
    expect(cache.get(query)).toBeNull();

    await writeFile(filePath, '{not a cache', 'utf8');
    const corrupt = new LyricsCache(filePath);
    await corrupt.init();
    expect(corrupt.get(query)).toBeNull();
  });
});
