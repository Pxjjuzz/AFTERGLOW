import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const executablePath = path.join(
  projectRoot,
  'out',
  'AfterGlowV2-win32-x64',
  'afterglowv2.exe',
);
const audioPath = path.join(projectRoot, 'samples', 'afterglow-sample.wav');
const lyricsPath = path.join(projectRoot, 'samples', 'afterglow-sample.lrc');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForDevTools(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged app exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The DevTools endpoint is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The packaged app did not expose its DevTools endpoint in time.');
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
      resolve();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    }
  });
}

test('packaged Windows build opens, restores files, plays, enters fullscreen, and exits', async () => {
  test.skip(!existsSync(executablePath), 'Run npm run package before the packaged smoke test.');

  const userData = await mkdtemp(path.join(tmpdir(), 'afterglowv2-packaged-'));
  const port = await freePort();
  const child = spawn(
    executablePath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
    {
      env: { ...process.env, AFTERGLOWV2_USER_DATA: userData },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let browser: Browser | null = null;

  try {
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitForDevTools(port, child);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
    }

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error('The packaged app did not expose a browser context.');
    const pages = context.pages();
    const page: Page =
      pages.find((candidate) => candidate.url().includes('index.html')) ?? pages[0]!;
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('manual-tab').click();
    await expect(page.getByTestId('setup-screen')).toBeVisible();

    const selected = await page.evaluate(
      async ({ audio, lyrics }) => {
        const audioResult = await window.afterglow.files.validate('audio', audio);
        if (!audioResult.ok) throw new Error(audioResult.error.message);
        const lyricsResult = await window.afterglow.files.validate('lyrics', lyrics);
        if (!lyricsResult.ok) throw new Error(lyricsResult.error.message);
        await window.afterglow.settings.remember(audioResult.file);
        await window.afterglow.settings.remember(lyricsResult.file);
        return [audioResult.file.name, lyricsResult.file.name];
      },
      { audio: audioPath, lyrics: lyricsPath },
    );
    expect(selected).toEqual(['afterglow-sample.wav', 'afterglow-sample.lrc']);

    // A reload is a realistic cold restore: the recent files come back from
    // the SQLite database inside the packaged app.
    await page.reload();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('manual-tab').click();
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByTestId('audio-dropzone')).toContainText('afterglow-sample.wav');
    await expect(page.getByTestId('lyrics-dropzone')).toContainText('First Light');

    await page.getByTestId('enter-experience').click();
    await expect(page.getByTestId('experience-screen')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.afterglow.experience.isFullscreen()))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const audio = document.querySelector('audio');
          return audio instanceof HTMLAudioElement ? !audio.paused : false;
        }),
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.afterglow.experience.isFullscreen()))
      .toBe(false);
    await expect(page.getByTestId('audio-dropzone')).toContainText('afterglow-sample.wav');

    await page.evaluate(() => window.afterglow.window.close());
    await page.waitForEvent('close', { timeout: 5000 }).catch(() => undefined);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await stopProcess(child);
    await rm(userData, { recursive: true, force: true });
  }
});
