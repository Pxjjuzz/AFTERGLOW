import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const audioPath = path.join(projectRoot, 'samples', 'afterglow-sample.wav');
const lyricsPath = path.join(projectRoot, 'samples', 'afterglow-sample.lrc');

async function isFullscreen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.isVisible(),
    );
    return Boolean(window && window.isFullScreen());
  });
}

async function openManualTab(page: Page): Promise<void> {
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('manual-tab').click();
  await expect(page.getByTestId('setup-screen')).toBeVisible();
}

async function audioState(page: Page): Promise<{ paused: boolean; currentTime: number; duration: number }> {
  return page.evaluate(() => {
    const audio = document.querySelector('audio');
    if (!(audio instanceof HTMLAudioElement)) {
      return { paused: true, currentTime: 0, duration: 0 };
    }
    return { paused: audio.paused, currentTime: audio.currentTime, duration: audio.duration };
  });
}

async function stubDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [selectedPath],
      bookmarks: [],
    })) as typeof dialog.showOpenDialog;
  }, filePath);
}

test('setup, fullscreen experience, keyboard control, and re-entry', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'afterglow-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AFTERGLOW_E2E: '1',
      AFTERGLOW_USER_DATA: userData,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await openManualTab(page);

    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AFTERGLOW' })).toBeVisible();
    await expect(page.getByTestId('enter-experience')).toBeDisabled();
    await expect(page.getByTestId('audio-dropzone')).toBeVisible();
    await expect(page.getByTestId('lyrics-dropzone')).toBeVisible();

    await stubDialog(app, audioPath);
    await page.getByTestId('audio-dropzone').click();
    await expect(page.getByTestId('audio-dropzone')).toContainText('afterglow-sample.wav');

    await stubDialog(app, lyricsPath);
    await page.getByTestId('lyrics-dropzone').click();
    await expect(page.getByTestId('lyrics-dropzone')).toContainText('afterglow-sample.lrc');
    await expect(page.getByTestId('lyrics-dropzone')).toContainText('First Light');
    await expect(page.getByTestId('enter-experience')).toBeEnabled();

    await page.getByTestId('enter-experience').click();
    await expect(page.getByTestId('experience-screen')).toBeVisible();
    await expect.poll(() => isFullscreen(app), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false);

    // No persistent player chrome. The only controls are the temporary pill,
    // which starts concealed and is not a dashboard/player bar.
    const controls = page.getByTestId('temporary-controls');
    await expect(controls).toHaveAttribute('data-visible', 'false');
    expect(await controls.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
    await expect(page.locator('[data-testid="setup-screen"]')).toHaveCount(0);
    const visibleStageChildren = await page.evaluate(() =>
      Array.from(document.querySelector('.experience-stage')?.children ?? []).map((child) => ({
        testId: child.getAttribute('data-testid'),
        tag: child.tagName.toLowerCase(),
        opacity: getComputedStyle(child).opacity,
      })),
    );
    expect(visibleStageChildren.map((child) => child.testId)).toEqual([
      'experience-canvas',
      null,
      'temporary-controls',
    ]);

    // Space freezes the authoritative audio clock.
    await page.keyboard.press('Space');
    await expect.poll(async () => (await audioState(page)).paused).toBe(true);
    const pausedAt = (await audioState(page)).currentTime;

    // Arrow keys seek by five seconds even while paused.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await audioState(page)).currentTime).toBeGreaterThan(pausedAt + 4.5);
    const afterRight = (await audioState(page)).currentTime;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await audioState(page)).currentTime).toBeLessThan(afterRight - 4.5);

    // Seeking temporarily reveals the pill; let that auto-hide, then test H.
    await expect(controls).toHaveAttribute('data-visible', 'false', { timeout: 6000 });
    await page.keyboard.press('h');
    await expect(controls).toHaveAttribute('data-visible', 'true');
    await expect.poll(async () => controls.evaluate((element) => getComputedStyle(element).opacity), {
      timeout: 2000,
    }).toBe('1');
    await page.keyboard.press('h');
    await expect(controls).toHaveAttribute('data-visible', 'false');
    await page.keyboard.press('h');
    await expect(controls).toHaveAttribute('data-visible', 'true');
    await expect(controls).toHaveAttribute('data-visible', 'false', { timeout: 6000 });

    // Escape leaves fullscreen, pauses, and preserves both files.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect.poll(() => isFullscreen(app), { timeout: 10_000 }).toBe(false);
    await expect(page.getByTestId('audio-dropzone')).toContainText('afterglow-sample.wav');
    await expect(page.getByTestId('lyrics-dropzone')).toContainText('afterglow-sample.lrc');
    await expect.poll(async () => (await audioState(page)).paused).toBe(true);

    // Re-entry must work without reselecting the files.
    await page.getByTestId('enter-experience').click();
    await expect(page.getByTestId('experience-screen')).toBeVisible();
    await expect.poll(() => isFullscreen(app), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect.poll(() => isFullscreen(app), { timeout: 10_000 }).toBe(false);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
