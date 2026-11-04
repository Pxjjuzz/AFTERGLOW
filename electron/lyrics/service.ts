import { readFile } from 'node:fs/promises';
import { parseLrc } from '../../src/features/lyrics/lrcParser';
import type { AutoLyricsPayload } from '../../shared/ipc';
import type { LyricsCache } from './lyricsCache';
import type { LyricsLookupResult, LyricsProvider, LyricsQuery } from './types';

export interface LyricsServiceOptions {
  cache: LyricsCache;
  provider: LyricsProvider;
  getOnlineEnabled: () => boolean;
  /** Test/demo hook: serve a local LRC instead of contacting a provider. */
  fakeLrcPath?: string;
}

export class LyricsService implements LyricsProvider {
  private readonly cache: LyricsCache;
  private readonly provider: LyricsProvider;
  private readonly getOnlineEnabled: () => boolean;
  private readonly fakeLrcPath: string | null;

  constructor(options: LyricsServiceOptions) {
    this.cache = options.cache;
    this.provider = options.provider;
    this.getOnlineEnabled = options.getOnlineEnabled;
    this.fakeLrcPath = options.fakeLrcPath ?? process.env.AFTERGLOWV2_FAKE_LYRICS ?? null;
  }

  async find(query: LyricsQuery): Promise<LyricsLookupResult> {
    const cached = this.cache.get(query);
    if (cached) {
      return {
        status: 'ready',
        payload: { ...cached, provider: 'cache' },
      };
    }

    if (this.fakeLrcPath) {
      try {
        const text = await readFile(this.fakeLrcPath, 'utf8');
        const parsed = parseLrc(text);
        if (parsed.ok && parsed.lyrics.lines.length > 0) {
          const payload: AutoLyricsPayload = {
            lrc: text,
            provider: 'cache',
            matchedTitle: query.title,
            matchedArtist: query.artist,
            matchedDuration: query.duration,
            score: 1,
            instrumental: false,
          };
          return { status: 'ready', payload };
        }
        return { status: 'error', message: 'The configured local lyrics file is not valid LRC.' };
      } catch (error) {
        return {
          status: 'error',
          message:
            error instanceof Error
              ? `The configured local lyrics file could not be read: ${error.message}`
              : 'The configured local lyrics file could not be read.',
        };
      }
    }

    if (!this.getOnlineEnabled()) {
      return {
        status: 'disabled',
        message: 'Online lyrics are turned off. Import an .lrc file or enable LRCLIB lookups.',
      };
    }

    const result = await this.provider.find(query);
    if (result.status === 'ready') {
      await this.cache.set(query, result.payload).catch(() => undefined);
    }
    return result;
  }
}
