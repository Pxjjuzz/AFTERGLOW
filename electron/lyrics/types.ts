import type { AutoLyricsPayload } from '../../shared/ipc';

export interface LyricsQuery {
  title: string;
  artist: string;
  album: string;
  /** Seconds; 0 when the player did not expose a duration. */
  duration: number;
}

export type LyricsLookupResult =
  | { status: 'ready'; payload: AutoLyricsPayload }
  | { status: 'instrumental'; message: string }
  | { status: 'not-found'; message: string }
  | { status: 'disabled'; message: string }
  | { status: 'error'; message: string };

/**
 * Every lyrics source implements this narrow interface. LRCLIB is the only
 * bundled provider; adding another permitted source means implementing
 * `find()` and registering it, without touching the engine.
 */
export interface LyricsProvider {
  find(query: LyricsQuery): Promise<LyricsLookupResult>;
}
