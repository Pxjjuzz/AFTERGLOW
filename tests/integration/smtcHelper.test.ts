import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { SMTC_HELPER_SCRIPT } from '../../electron/media/smtcScript';
import { parseHelperLine, type HelperMessage } from '../../electron/media/smtcMonitor';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

describe('Windows media-session helper', () => {
  it.skipIf(process.platform !== 'win32')(
    'starts, emits a parseable JSON line, and stops cleanly',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'afterglowv2-smtc-'));
      roots.push(root);
      const scriptPath = path.join(root, 'smtc-helper.ps1');
      await writeFile(scriptPath, SMTC_HELPER_SCRIPT, 'utf8');

      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      try {
        const line = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('The SMTC helper did not emit a line in time.'));
          }, 25_000);
          const reader = createInterface({ input: child.stdout });
          reader.once('line', (value) => {
            clearTimeout(timer);
            resolve(value);
          });
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`The SMTC helper exited early with code ${code}.`));
          });
        });

        const message: HelperMessage | null = parseHelperLine(line);
        expect(message).not.toBeNull();
        expect(['sessions', 'error']).toContain(message?.type);
        if (message?.type === 'sessions') {
          expect(Array.isArray(message.sessions)).toBe(true);
          for (const session of message.sessions) {
            expect(typeof session.id).toBe('string');
            expect(typeof session.title).toBe('string');
            expect(Number.isFinite(session.position)).toBe(true);
            expect(Number.isFinite(session.duration)).toBe(true);
          }
        }
      } finally {
        killTree(child.pid);
      }
    },
    30_000,
  );
});
