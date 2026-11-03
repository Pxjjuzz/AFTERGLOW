import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import type { FileError, MediaSource } from '../../shared/ipc';
import { mimeTypeFor, validateSelectedPath } from './validation';

interface MediaEntry {
  path: string;
  mimeType: string;
  size: number;
}

const sources = new Map<string, MediaEntry>();

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'afterglow-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

export async function createMediaSource(
  rawPath: unknown,
): Promise<{ ok: true; source: MediaSource } | { ok: false; error: FileError }> {
  const validated = await validateSelectedPath(rawPath, 'audio');
  if (!validated.ok) return validated;

  const mimeType = mimeTypeFor(validated.file.path);
  if (!mimeType) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_TYPE', message: 'That audio format is not supported.' },
    };
  }

  const token = randomUUID();
  sources.set(token, {
    path: validated.file.path,
    mimeType,
    size: validated.file.size,
  });

  return {
    ok: true,
    source: {
      url: `afterglow-media://track/${token}`,
      token,
      mimeType,
      size: validated.file.size,
    },
  };
}

export function releaseMediaSource(token: string): void {
  sources.delete(token);
}

export function releaseAllMediaSources(): void {
  sources.clear();
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';

  if (startRaw === '' && endRaw === '') return null;

  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

function streamBody(filePath: string, start?: number, end?: number): BodyInit {
  const stream =
    start === undefined
      ? createReadStream(filePath)
      : createReadStream(filePath, { start, end });
  return Readable.toWeb(stream) as unknown as BodyInit;
}

/** Install the token-gated media protocol after the app is ready. */
export function installMediaProtocol(): void {
  protocol.handle('afterglow-media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'track') {
        return new Response('Not found', { status: 404 });
      }
      const token = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const entry = sources.get(token);
      if (!entry) {
        return new Response('Not found', { status: 404 });
      }

      let size: number;
      try {
        const stats = await stat(entry.path);
        if (!stats.isFile()) throw new Error('not a file');
        size = stats.size;
      } catch {
        sources.delete(token);
        return new Response('Source unavailable', { status: 404 });
      }

      const baseHeaders: Record<string, string> = {
        'Content-Type': entry.mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      };

      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(size) },
        });
      }

      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        const range = parseRange(rangeHeader, size);
        if (!range) {
          return new Response(null, {
            status: 416,
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes */${size}`,
            },
          });
        }
        return new Response(streamBody(entry.path, range.start, range.end), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(range.end - range.start + 1),
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          },
        });
      }

      return new Response(streamBody(entry.path), {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(size) },
      });
    } catch (error) {
      console.error('[afterglow] media protocol error', error);
      return new Response('Media error', { status: 500 });
    }
  });
}
