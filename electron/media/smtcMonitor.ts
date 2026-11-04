import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { MediaPlaybackStatus, MediaSessionInfo } from '../../shared/ipc';
import { SMTC_HELPER_SCRIPT } from './smtcScript';

export interface MediaSnapshot {
  at: number;
  sessions: MediaSessionInfo[];
}

export interface MediaMonitor {
  readonly running: boolean;
  start(): void;
  stop(): void;
  onSnapshot(listener: (snapshot: MediaSnapshot) => void): () => void;
  onError(listener: (message: string) => void): () => void;
}

const STATUSES: readonly MediaPlaybackStatus[] = [
  'playing',
  'paused',
  'stopped',
  'closed',
  'changing',
  'opened',
  'unknown',
];

function asStatus(value: unknown): MediaPlaybackStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as MediaPlaybackStatus)
    : 'unknown';
}

function asText(value: unknown, max = 512): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 24 * 60 * 60);
}

export function normalizeSession(raw: unknown): MediaSessionInfo | null {
  if (raw === null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = asText(record.id ?? record.app, 512);
  if (!id) return null;
  const duration = asSeconds(record.duration);
  const position = asSeconds(record.position);
  return {
    id,
    app: asText(record.app, 512) || id,
    title: asText(record.title),
    artist: asText(record.artist),
    album: asText(record.album),
    status: asStatus(record.status),
    position: duration > 0 ? Math.min(position, duration) : position,
    duration,
  };
}

export interface HelperMessage {
  type: 'sessions' | 'error';
  at: number;
  sessions: MediaSessionInfo[];
  message: string | null;
}

/** Parse one JSON line emitted by the PowerShell helper. */
export function parseHelperLine(line: string): HelperMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const at =
    typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now();
  if (record.type === 'error') {
    return {
      type: 'error',
      at,
      sessions: [],
      message: asText(record.message) || 'Windows media session helper failed.',
    };
  }
  if (record.type !== 'sessions') return null;
  const rawSessions = Array.isArray(record.sessions) ? record.sessions : [];
  const sessions = rawSessions
    .map((entry) => normalizeSession(entry))
    .filter((entry): entry is MediaSessionInfo => entry !== null);
  return { type: 'sessions', at, sessions, message: null };
}

export interface SmtcMonitorOptions {
  scriptPath: string;
  restartDelayMs?: number;
  /** Injectable for tests. */
  spawnProcess?: typeof spawn;
}

export class SmtcMonitor implements MediaMonitor {
  private readonly scriptPath: string;
  private readonly restartDelayMs: number;
  private readonly spawnProcess: typeof spawn;
  private readonly snapshotListeners = new Set<(snapshot: MediaSnapshot) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private started = false;
  private starting = false;
  private _running = false;

  constructor(options: SmtcMonitorOptions) {
    this.scriptPath = options.scriptPath;
    this.restartDelayMs = options.restartDelayMs ?? 3000;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  get running(): boolean {
    return this._running;
  }

  onSnapshot(listener: (snapshot: MediaSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.launch();
  }

  stop(): void {
    this.started = false;
    this._running = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.reader?.close();
    this.reader = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.kill();
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }

  private async launch(): Promise<void> {
    if (!this.started || this.starting || this.child) return;
    this.starting = true;
    try {
      await mkdir(path.dirname(this.scriptPath), { recursive: true });
      await writeFile(this.scriptPath, SMTC_HELPER_SCRIPT, 'utf8');
      if (!this.started) return;

      const child = this.spawnProcess(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.scriptPath,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      ) as unknown as ChildProcessWithoutNullStreams;

      this.child = child;
      this._running = true;

      const reader = createInterface({ input: child.stdout });
      this.reader = reader;
      reader.on('line', (line) => {
        const message = parseHelperLine(line);
        if (!message) return;
        if (message.type === 'error') {
          this.emitError(message.message ?? 'Windows media session helper failed.');
          return;
        }
        const snapshot: MediaSnapshot = { at: message.at, sessions: message.sessions };
        for (const listener of this.snapshotListeners) listener(snapshot);
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1200);
      });

      child.on('error', (error) => {
        this.emitError(`The Windows media session helper could not start: ${error.message}`);
      });

      child.on('exit', (code) => {
        if (this.child === child) this.child = null;
        this._running = false;
        this.reader?.close();
        this.reader = null;
        if (!this.started) return;
        const detail = stderr.trim().split(/\r?\n/).slice(-1)[0] ?? '';
        this.emitError(
          detail
            ? `Windows media session helper stopped: ${detail}`
            : `Windows media session helper stopped (exit ${code ?? 'unknown'}).`,
        );
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          void this.launch();
        }, this.restartDelayMs);
      });
    } catch (error) {
      this._running = false;
      this.emitError(
        error instanceof Error
          ? `Windows media session helper could not start: ${error.message}`
          : 'Windows media session helper could not start.',
      );
    } finally {
      this.starting = false;
    }
  }
}

/**
 * Test/demo monitor. It reads the same JSON shape from a file every poll so the
 * end-to-end suite can drive playback transitions without touching real audio.
 */
export class FakeMediaMonitor implements MediaMonitor {
  private readonly filePath: string;
  private readonly intervalMs: number;
  private readonly snapshotListeners = new Set<(snapshot: MediaSnapshot) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private timer: NodeJS.Timeout | null = null;
  private _running = false;
  private lastError: string | null = null;

  constructor(filePath: string, intervalMs = 250) {
    this.filePath = filePath;
    this.intervalMs = intervalMs;
  }

  get running(): boolean {
    return this._running;
  }

  onSnapshot(listener: (snapshot: MediaSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    this._running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (!this._running) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const record =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { sessions: parsed };
      const rawSessions = Array.isArray(record.sessions) ? record.sessions : [];
      const sessions = rawSessions
        .map((entry) => normalizeSession(entry))
        .filter((entry): entry is MediaSessionInfo => entry !== null);
      this.lastError = null;
      for (const listener of this.snapshotListeners) {
        listener({ at: Date.now(), sessions });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fake media snapshot could not be read.';
      if (message !== this.lastError) {
        this.lastError = message;
        for (const listener of this.errorListeners) listener(message);
      }
    }
  }
}

export function createMediaMonitor(scriptPath: string): MediaMonitor {
  const fakePath = process.env.AFTERGLOWV2_FAKE_MEDIA;
  if (fakePath) return new FakeMediaMonitor(path.resolve(fakePath));
  return new SmtcMonitor({ scriptPath });
}
