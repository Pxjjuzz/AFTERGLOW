import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLyricFile, validateSelectedPath } from '../../electron/files/validation';

let root = '';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'afterglow-validation-'));
  await writeFile(path.join(root, 'song.mp3'), Buffer.alloc(2048, 1));
  await writeFile(path.join(root, 'lyrics.lrc'), '\uFEFF[00:01.00]Hello');
  await writeFile(path.join(root, 'empty.lrc'), '');
  await writeFile(path.join(root, 'notes.txt'), 'not an audio file');
  await mkdir(path.join(root, 'folder.lrc'));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('validateSelectedPath', () => {
  it('accepts a readable audio file and returns a canonical descriptor', async () => {
    const result = await validateSelectedPath(path.join(root, 'song.mp3'), 'audio');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.name).toBe('song.mp3');
    expect(result.file.extension).toBe('.mp3');
    expect(result.file.kind).toBe('audio');
    expect(result.file.size).toBe(2048);
    expect(path.isAbsolute(result.file.path)).toBe(true);
  });

  it('rejects bytes passed as a path and relative paths', async () => {
    const bytes = await validateSelectedPath(new Uint8Array([1, 2]), 'audio');
    const relative = await validateSelectedPath('song.mp3', 'audio');
    expect(bytes.ok).toBe(false);
    if (!bytes.ok) expect(bytes.error.code).toBe('INVALID_PATH');
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.error.code).toBe('INVALID_PATH');
  });

  it('rejects missing files, directories, wrong kinds, and empty files', async () => {
    const missing = await validateSelectedPath(path.join(root, 'missing.wav'), 'audio');
    const folder = await validateSelectedPath(path.join(root, 'folder.lrc'), 'lyrics');
    const wrongKind = await validateSelectedPath(path.join(root, 'notes.txt'), 'audio');
    const empty = await validateSelectedPath(path.join(root, 'empty.lrc'), 'lyrics');

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
    expect(folder.ok).toBe(false);
    if (!folder.ok) expect(folder.error.code).toBe('NOT_A_FILE');
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.error.code).toBe('UNSUPPORTED_TYPE');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_FILE');
  });
});

describe('readLyricFile', () => {
  it('reads UTF-8 lyrics and strips the BOM', async () => {
    const result = await readLyricFile(path.join(root, 'lyrics.lrc'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('[00:01.00]Hello');
    expect(result.file.kind).toBe('lyrics');
  });

  it('rejects non-lyric and empty files', async () => {
    const wrong = await readLyricFile(path.join(root, 'song.mp3'));
    const empty = await readLyricFile(path.join(root, 'empty.lrc'));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('UNSUPPORTED_TYPE');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_FILE');
  });
});
