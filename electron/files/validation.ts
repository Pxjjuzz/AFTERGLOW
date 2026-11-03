import { open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AUDIO_EXTENSIONS,
  LYRICS_EXTENSIONS,
  MAX_AUDIO_BYTES,
  MAX_LYRICS_BYTES,
  type FileError,
  type FileErrorCode,
  type FileKind,
  type FileResult,
  type LyricReadResult,
  type SelectedFile,
} from '../../shared/ipc';

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

const EXTENSIONS: Record<FileKind, readonly string[]> = {
  audio: AUDIO_EXTENSIONS,
  lyrics: LYRICS_EXTENSIONS,
};

const SIZE_LIMITS: Record<FileKind, number> = {
  audio: MAX_AUDIO_BYTES,
  lyrics: MAX_LYRICS_BYTES,
};

const KIND_LABEL: Record<FileKind, string> = {
  audio: 'audio',
  lyrics: 'LRC lyrics',
};

export function fail(code: FileErrorCode, message: string): FileResult {
  return { ok: false, error: { code, message } };
}

export function fileError(code: FileErrorCode, message: string): FileError {
  return { code, message };
}

export function mimeTypeFor(filePath: string): string | null {
  return AUDIO_MIME[path.extname(filePath).toLowerCase()] ?? null;
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function friendlyExtensionList(kind: FileKind): string {
  return EXTENSIONS[kind]
    .map((extension) => extension.slice(1).toUpperCase())
    .join(', ');
}

function invalidPath(message: string): FileResult {
  return fail('INVALID_PATH', message);
}

/**
 * Validate a path supplied by the renderer. The renderer never receives a
 * directory handle; it only ever sends an absolute path that came from a native
 * dialog or from Electron's drag-and-drop `webUtils` bridge.
 */
export async function validateSelectedPath(rawPath: unknown, kind: FileKind): Promise<FileResult> {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return invalidPath('No file path was provided.');
  }
  if (rawPath.length > 4096 || rawPath.includes('\0')) {
    return invalidPath('That file path is not valid.');
  }
  if (!path.isAbsolute(rawPath)) {
    return invalidPath('Only absolute local file paths are accepted.');
  }

  let canonical: string;
  try {
    canonical = await realpath(rawPath);
  } catch {
    return fail('NOT_FOUND', 'That file could not be found. It may have been moved or deleted.');
  }

  const extension = path.extname(canonical).toLowerCase();
  if (!EXTENSIONS[kind].includes(extension)) {
    return fail(
      'UNSUPPORTED_TYPE',
      `${KIND_LABEL[kind][0]?.toUpperCase() ?? ''}${KIND_LABEL[kind].slice(1)} must be one of: ${friendlyExtensionList(kind)}.`,
    );
  }

  let stats;
  try {
    stats = await stat(canonical);
  } catch {
    return fail('NOT_FOUND', 'That file could not be read. It may have been moved or deleted.');
  }

  if (!stats.isFile()) {
    return fail('NOT_A_FILE', 'That path is not a file.');
  }
  if (stats.size === 0) {
    return fail('EMPTY_FILE', 'That file is empty.');
  }
  if (stats.size > SIZE_LIMITS[kind]) {
    return fail('TOO_LARGE', `That file is larger than the ${formatLimit(SIZE_LIMITS[kind])} limit.`);
  }

  try {
    const handle = await open(canonical, 'r');
    await handle.close();
  } catch {
    return fail('UNREADABLE', 'That file cannot be read. Check its permissions and try again.');
  }

  const file: SelectedFile = {
    path: canonical,
    name: path.basename(canonical),
    kind,
    extension,
    size: stats.size,
  };
  return { ok: true, file };
}

export async function readLyricFile(rawPath: unknown): Promise<LyricReadResult> {
  const validated = await validateSelectedPath(rawPath, 'lyrics');
  if (!validated.ok) return validated;

  try {
    const text = await readFile(validated.file.path, 'utf8');
    if (text.trim().length === 0) {
      return { ok: false, error: fileError('EMPTY_FILE', 'That LRC file contains no text.') };
    }
    return { ok: true, file: validated.file, text: text.replace(/^\uFEFF/, '') };
  } catch {
    return {
      ok: false,
      error: fileError('UNREADABLE', 'The lyrics file could not be read.'),
    };
  }
}
