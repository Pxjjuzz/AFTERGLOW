import { describe, expect, it, vi } from 'vitest';
import {
  LrclibClient,
  baseTitle,
  normalizeForMatch,
  pickBestCandidate,
  scoreCandidate,
  validateSyncedLyrics,
  versionFlags,
  type LrclibRecord,
} from '../../electron/lyrics/lrclib';
import type { LyricsQuery } from '../../electron/lyrics/types';

const synced =
  '[00:00.00]Is this the real life?\n[00:05.00]Is this just fantasy?\n[00:10.00]Caught in a landslide';

const query: LyricsQuery = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 355,
};

function record(overrides: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 1,
    trackName: 'Bohemian Rhapsody',
    artistName: 'Queen',
    albumName: 'A Night at the Opera',
    duration: 354,
    instrumental: false,
    plainLyrics: 'Is this the real life?',
    syncedLyrics: synced,
    ...overrides,
  };
}

describe('title and artist normalization', () => {
  it('strips accents, punctuation, and feat credits', () => {
    expect(normalizeForMatch('Beyoncé & Jay-Z')).toBe('beyonce and jay z');
    expect(normalizeForMatch('  Don’t Stop Me Now!  ')).toBe('dont stop me now');
    expect(baseTitle('Song Title (feat. Someone)')).toBe('song title');
    expect(baseTitle('Song Title - Live at Wembley')).toBe('song title');
    expect(baseTitle('Song Title - 2011 Remaster')).toBe('song title');
  });

  it('detects version qualifiers', () => {
    expect(versionFlags('Song (Remix)')).toContain('remix');
    expect(versionFlags('Song - Live')).toContain('live');
    expect(versionFlags('Song - Acoustic')).toContain('acoustic');
    expect(versionFlags('Plain Song')).toEqual(new Set());
  });
});

describe('candidate scoring', () => {
  it('prefers an exact studio match over a live version', () => {
    const studio = scoreCandidate(query, record());
    const live = scoreCandidate(
      query,
      record({
        trackName: 'Bohemian Rhapsody - Live Aid',
        albumName: 'Live Aid',
        duration: 300,
      }),
    );
    expect(studio).toBeGreaterThan(0.9);
    expect(studio).toBeGreaterThan(live);
  });

  it('penalizes a mismatched artist and duration', () => {
    const good = scoreCandidate(query, record());
    const wrongArtist = scoreCandidate(query, record({ artistName: 'Not Queen' }));
    const wrongDuration = scoreCandidate(query, record({ duration: 480 }));
    expect(good).toBeGreaterThan(wrongArtist);
    expect(good).toBeGreaterThan(wrongDuration);
  });

  it('only selects candidates with synced lyrics or an instrumental flag', () => {
    const plainOnly = pickBestCandidate(query, [record({ syncedLyrics: null })]);
    expect(plainOnly).toBeNull();

    const instrumental = pickBestCandidate(query, [
      record({ syncedLyrics: null, instrumental: true, trackName: 'Bohemian Rhapsody' }),
    ]);
    expect(instrumental?.candidate.instrumental).toBe(true);
  });

  it('prefers synced lyrics over an instrumental entry', () => {
    const best = pickBestCandidate(query, [
      record({ id: 1, syncedLyrics: null, instrumental: true }),
      record({ id: 2, syncedLyrics: synced }),
    ]);
    expect(best?.candidate.id).toBe(2);
  });
});

describe('validateSyncedLyrics', () => {
  it('accepts timestamped LRC and rejects plain text', () => {
    expect(validateSyncedLyrics(synced)).toBe(true);
    expect(validateSyncedLyrics('Is this the real life?')).toBe(false);
    expect(validateSyncedLyrics('')).toBe(false);
  });
});

describe('LrclibClient', () => {
  it('returns a ready payload for a confident match', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([record()]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof globalThis.fetch;
    const client = new LrclibClient({ fetchImpl, minIntervalMs: 0 });
    const result = await client.find(query);
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.payload.provider).toBe('lrclib');
      expect(result.payload.matchedTitle).toBe('Bohemian Rhapsody');
      expect(result.payload.score).toBeGreaterThan(0.6);
      expect(result.payload.instrumental).toBe(false);
    }
  });

  it('reports instrumentals instead of opening an empty scene', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([record({ instrumental: true, syncedLyrics: null })]),
        { status: 200 },
      ),
    ) as unknown as typeof globalThis.fetch;
    const client = new LrclibClient({ fetchImpl, minIntervalMs: 0 });
    const result = await client.find(query);
    expect(result.status).toBe('instrumental');
  });

  it('returns not-found for empty results and for low-confidence matches', async () => {
    const empty = new LrclibClient({
      fetchImpl: (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    expect((await empty.find(query)).status).toBe('not-found');

    const weak = new LrclibClient({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify([
            record({
              trackName: 'Completely Different',
              artistName: 'Someone Else',
              duration: 90,
            }),
          ]),
          { status: 200 },
        )) as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    expect((await weak.find(query)).status).toBe('not-found');
  });

  it('does not contact the provider without a title', async () => {
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;
    const client = new LrclibClient({ fetchImpl, minIntervalMs: 0 });
    const result = await client.find({ ...query, title: '   ' });
    expect(result.status).toBe('not-found');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces network failures as an error result', async () => {
    const client = new LrclibClient({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      minIntervalMs: 0,
      retries: 0,
    });
    const result = await client.find(query);
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toContain('offline');
  });

  it('handles a 404 as no matches', async () => {
    const client = new LrclibClient({
      fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    expect((await client.find(query)).status).toBe('not-found');
  });
});
