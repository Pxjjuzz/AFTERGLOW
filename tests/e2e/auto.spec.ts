import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaSessionInfo } from '@shared/ipc';

const projectRoot = process.cwd();
const lyricsPath = path.join(projectRoot, 'samples', 'afterglow-sample.lrc');

interface Harness {
  app: ElectronApplication;
  userData: string;
  mediaPath: string;
}

async function writeMedia(filePath: string, sessions: MediaSessionInfo[]): Promise<void> {
  await writeFile(filePath, JSON.stringify({ sessions }), 'utf8');
}

function playing(overrides: Partial<MediaSessionInfo> = {}): MediaSessionInfo {
  return {
    id: 'AfterGlowTestPlayer.exe',
    app: 'AfterGlowTestPlayer.exe',
    title: 'First Light',
    artist: 'AfterGlow',
    album: 'Sample',
    status: 'playing',
    position: 1,
    duration: 200,
    ...overrides,
  };
}

async function overlayWindow(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('mode=overlay'),
    );
    return window
      ? { visible: window.isVisible(), fullscreen: window.isFullScreen() }
      : null;
  });
}

async function waitForOverlay(app: ElectronApplication): Promise<void> {
  await expect
    .poll(async () => (await overlayWindow(app))?.visible ?? false, { timeout: 20_000 })
    .toBe(true);
}

async function launch(captureAudio = false): Promise<Harness> {
  const userData = await mkdtemp(path.join(tmpdir(), 'afterglowv2-auto-e2e-'));
  const mediaPath = path.join(userData, 'media.json');
  await writeFile(
    path.join(userData, 'auto-settings.json'),
    JSON.stringify({
      enabled: true,
      monitoredPlayer: '',
      entryDelayMs: 0,
      exitDelayMs: 600,
      pauseDelayMs: 200,
      pauseBehavior: 'keep',
      onlineLyrics: false,
      captureAudio,
      overlayControls: true,
    }),
    'utf8',
  );
  // A short notification sound must not open the scene.
  await writeMedia(mediaPath, [
    playing({ title: 'Notification', duration: 5, position: 0 }),
  ]);

  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AFTERGLOWV2_USER_DATA: userData,
      AFTERGLOWV2_FAKE_MEDIA: mediaPath,
      AFTERGLOWV2_FAKE_LYRICS: lyricsPath,
    },
  });

  return { app, userData, mediaPath };
}

async function openSettings(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('automatic-tab')).toBeVisible();
}

test('automatic mode ignores short sounds, opens on lyrics, syncs visuals, and reopens after a pause', async () => {
  const harness = await launch();
  const { app, userData, mediaPath } = harness;

  try {
    const settings = await app.firstWindow();
    await openSettings(settings);

    // Give the fake monitor a couple of polls. The notification track is too
    // short to earn a fullscreen takeover.
    await expect
      .poll(async () => (await overlayWindow(app))?.visible ?? false, { timeout: 4000 })
      .toBe(false);
    await expect(settings.getByTestId('auto-current-title')).toContainText('Notification');

    const overlayPromise = app.waitForEvent('window', { timeout: 20_000 });
    await writeMedia(mediaPath, [playing()]);
    const overlay = await overlayPromise;
    await overlay.waitForLoadState('domcontentloaded');
    await expect(overlay.getByTestId('auto-experience')).toBeVisible();
    await expect(overlay.getByTestId('auto-experience-canvas')).toBeVisible();
    await expect(overlay.getByTestId('auto-track-title')).toContainText('First Light');
    await waitForOverlay(app);

    const state = await overlayWindow(app);
    expect(state?.fullscreen).toBe(true);

    // The track pill is not persistent chrome: it is concealed until the
    // pointer moves, and Space only freezes the visual clock.
    const pill = overlay.getByTestId('auto-track-pill');
    await expect(pill).toHaveAttribute('data-visible', 'false');
    await overlay.mouse.move(60, 60);
    await expect(pill).toHaveAttribute('data-visible', 'true');

    await overlay.keyboard.press('Space');
    await expect(overlay.getByTestId('auto-experience')).toHaveAttribute(
      'data-visual-paused',
      'true',
    );
    await expect(overlay.getByTestId('auto-pill-state')).toContainText('VISUAL PAUSED');
    await overlay.keyboard.press('Space');
    await expect(overlay.getByTestId('auto-experience')).toHaveAttribute(
      'data-visual-paused',
      'false',
    );

    // Esc returns to the desktop but leaves automatic mode listening.
    await overlay.keyboard.press('Escape');
    await expect
      .poll(async () => (await overlayWindow(app))?.visible ?? false, { timeout: 8000 })
      .toBe(false);
    await expect(settings.getByTestId('settings-screen')).toBeVisible();

    // A pause/resume clears the dismissal, and the scene comes back without a
    // restart. The fake player is still the same track.
    await writeMedia(mediaPath, [playing({ status: 'paused', position: 30 })]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await writeMedia(mediaPath, [playing({ position: 30 })]);
    await waitForOverlay(app);

    // A track change updates the scene in place.
    await writeMedia(mediaPath, [
      playing({
        title: 'Second Sky',
        artist: 'Another Artist',
        duration: 240,
        position: 0,
      }),
    ]);
    await expect(overlay.getByTestId('auto-track-title')).toContainText('Second Sky', {
      timeout: 20_000,
    });
    await expect(overlay.getByTestId('auto-experience')).toHaveAttribute(
      'data-track-key',
      /second sky/i,
    );
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true });
  }
});

test('Windows loopback capture starts for the overlay without recording', async () => {
  const harness = await launch(true);
  const { app, userData, mediaPath } = harness;

  try {
    const settings = await app.firstWindow();
    await openSettings(settings);

    await writeMedia(mediaPath, [playing()]);
    await waitForOverlay(app);
    await expect(settings.getByTestId('auto-capture-status')).toContainText('active', {
      timeout: 20_000,
    });

    const overlay = app.windows().find((candidate) => candidate.url().includes('mode=overlay'));
    expect(overlay).toBeTruthy();
    await expect(overlay!.getByTestId('auto-experience')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true });
  }
});
