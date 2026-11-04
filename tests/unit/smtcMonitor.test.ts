import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaSessionInfo } from '@shared/ipc';
import {
  FakeMediaMonitor,
  normalizeSession,
  parseHelperLine,
  type MediaSnapshot,
} from '../../electron/media/smtcMonitor';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('normalizeSession', () => {
  it('normalizes a complete SMTC session', () => {
    expect(
      normalizeSession({
        id: 'Spotify.exe',
        app: 'Spotify.exe',
        title: '  First Light  ',
        artist: ' AfterGlow ',
        album: 'Sample',
        status: 'playing',
        position: 42.5,
        duration: 210.25,
      }),
    ).toEqual({
      id: 'Spotify.exe',
      app: 'Spotify.exe',
      title: 'First Light',
      artist: 'AfterGlow',
      album: 'Sample',
      status: 'playing',
      position: 42.5,
      duration: 210.25,
    });
  });

  it('clamps impossible positions and rejects entries without an id', () => {
    expect(
      normalizeSession({
        id: 'player',
        duration: 100,
        position: 999,
        status: 'playing',
      }),
    ).toMatchObject({ position: 100, duration: 100 });
    expect(normalizeSession({ title: 'No id' })).toBeNull();
    expect(normalizeSession(null)).toBeNull();
    expect(normalizeSession('nope')).toBeNull();
  });

  it('falls back to unknown status and app id', () => {
    const session = normalizeSession({ id: 'MusicBee.exe', status: 'buffering' });
    expect(session?.status).toBe('unknown');
    expect(session?.app).toBe('MusicBee.exe');
  });
});

describe('parseHelperLine', () => {
  it('parses the helper sessions line and drops malformed sessions', () => {
    const line = JSON.stringify({
      type: 'sessions',
      at: 1700000000000,
      sessions: [
        { id: 'A', title: 'One', status: 'playing', position: 1, duration: 200 },
        { title: 'missing id' },
      ],
    });
    const message = parseHelperLine(line);
    expect(message).not.toBeNull();
    expect(message?.type).toBe('sessions');
    expect(message?.at).toBe(1700000000000);
    expect(message?.sessions).toHaveLength(1);
    expect(message?.sessions[0]?.title).toBe('One');
  });

  it('parses error lines and ignores noise', () => {
    const message = parseHelperLine(JSON.stringify({ type: 'error', message: 'WinRT failed' }));
    expect(message).toMatchObject({ type: 'error', message: 'WinRT failed' });

    expect(parseHelperLine('')).toBeNull();
    expect(parseHelperLine('not json')).toBeNull();
    expect(parseHelperLine(JSON.stringify({ type: 'something' }))).toBeNull();
  });

  it('tolerates a missing timestamp', () => {
    const before = Date.now();
    const message = parseHelperLine(
      JSON.stringify({ type: 'sessions', sessions: [] }),
    );
    expect(message?.at).toBeGreaterThanOrEqual(before);
  });
});

describe('FakeMediaMonitor', () => {
  it('streams normalized sessions from a JSON file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'afterglowv2-fake-media-'));
    roots.push(root);
    const filePath = path.join(root, 'media.json');
    const sessions: MediaSessionInfo[] = [
      {
        id: 'Test.exe',
        app: 'Test.exe',
        title: 'First Light',
        artist: 'AfterGlow',
        album: 'Sample',
        status: 'playing',
        position: 3,
        duration: 200,
      },
    ];
    await writeFile(filePath, JSON.stringify({ sessions }), 'utf8');

    const monitor = new FakeMediaMonitor(filePath, 20);
    const received: MediaSnapshot[] = [];
    const unsubscribe = monitor.onSnapshot((snapshot) => received.push(snapshot));
    monitor.start();
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
    monitor.stop();
    unsubscribe();

    expect(monitor.running).toBe(false);
    expect(received[0]?.sessions[0]).toMatchObject({
      title: 'First Light',
      status: 'playing',
      duration: 200,
    });
  });

  it('reports unreadable snapshots once per distinct error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'afterglowv2-fake-media-'));
    roots.push(root);
    const filePath = path.join(root, 'media.json');
    const monitor = new FakeMediaMonitor(filePath, 20);
    const errors: string[] = [];
    const unsubscribe = monitor.onError((message) => errors.push(message));
    monitor.start();
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 80));
    monitor.stop();
    unsubscribe();
    expect(errors).toHaveLength(1);
  });
});
