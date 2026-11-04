# AfterGlowV2 — implementation report

Date: 2026-11-04
Host: Windows, x64

## Paths

- Original project (untouched):
  `C:\Users\PRAJWAL\OneDrive\Desktop\afterglow`
- New sibling project:
  `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2`
- Packaged executable:
  `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2\out\AfterGlowV2-win32-x64\afterglowv2.exe`
- Windows installer:
  `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2\out\make\squirrel.windows\x64\AfterGlowV2-2.0.0 Setup.exe`
- Portable ZIP:
  `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2\out\make\zip\win32\x64\AfterGlowV2-win32-x64-2.0.0.zip`
- Squirrel package:
  `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2\out\make\squirrel.windows\x64\afterglowv2-2.0.0-full.nupkg`

## Reused technology

- Electron, React, TypeScript, Vite, Tailwind, GSAP, Canvas 2D, Zustand,
  SQLite (`sql.js`), Electron Forge, Vitest, Playwright.
- Reused directly:
  - `src/features/constellation/ConstellationRenderer.ts`
  - `src/features/constellation/layout.ts` and `canvasMetrics.ts`
  - `src/features/lyrics/lrcParser.ts`
  - `src/features/lyrics/timeline.ts`
  - `src/components/experience/Experience.tsx`
  - `src/components/experience/TemporaryControls.tsx`
  - `src/services/audio/AudioService.ts`
  - `src/app/App.tsx` (Manual tab)
  - `src/stores/*`
  - `electron/persistence/settingsStore.ts`
  - `electron/files/mediaProtocol.ts` and validation
  - `electron/ipc/registerIpc.ts` (extended for two windows)
  - the original test setup and sample audio/LRC.

The visual engine, LRC parser, timeline, and manual experience are the real
AFTERGLOW implementations, not mockups.

## New modules

Main process:

- `electron/auto/autoSettings.ts` — sanitized automatic-mode settings and atomic
  JSON persistence.
- `electron/auto/engine.ts` — automatic-mode state machine: entry delay, exit
  grace, pause behavior, track changes, dismissal, manual lyrics, capture state,
  playback updates.
- `electron/media/smtcScript.ts` — embedded PowerShell/WinRT SMTC helper.
- `electron/media/smtcMonitor.ts` — long-running helper process, JSON-line
  parser, normalization, restart handling, and a fake monitor for tests.
- `electron/lyrics/types.ts` — provider interface.
- `electron/lyrics/lrclib.ts` — LRCLIB search, scoring, version flags,
  validation, rate limiting, retries, and timeouts.
- `electron/lyrics/lyricsCache.ts` — local cache with expiry and corruption
  recovery.
- `electron/lyrics/service.ts` — cache/provider/manual-fallback orchestration.
- `electron/ipc/registerAutoIpc.ts` — trusted automatic-mode IPC surface.
- `electron/main.ts` — rewritten for tray, settings window, overlay window,
  display-media loopback handler, single instance, power blocker, and lifecycle.
- `electron/preload.ts` — extended with the `window.afterglow.auto` bridge.
- `shared/ipc.ts` — extended with the automatic-mode contract.

Renderer:

- `src/auto/SettingsApp.tsx` — Automatic/Manual settings UI.
- `src/auto/AutoExperience.tsx` — automatic overlay using the real renderer.
- `src/auto/ManualOverlay.tsx` — manual overlay reusing `Experience`.
- `src/auto/useRemotePlayback.ts` — SMTC position extrapolation and visual-only
  pause.
- `src/auto/useLoopbackCapture.ts` — in-memory WASAPI loopback analyser.
- `src/auto/OverlayApp.tsx` — overlay window shell.
- `src/main.tsx` — mode routing (`settings`, `overlay`, legacy app).
- `src/styles/index.css` — settings and overlay styling.

No new runtime npm dependencies were added. The WinRT bridge uses the built-in
PowerShell; loopback uses Electron's built-in display-media support.

## Completed features

- Windows media-session detection through WinRT SMTC:
  title, artist, album, playback status, position, and duration.
- Start/pause/resume/stop/track-change detection, with configurable entry and
  exit delays.
- Notification-sound filtering: tracks under 20 seconds are ignored, and
  metadata-poor sessions without artist/duration are treated as notifications.
- Player selection (all players or one SMTC source) from settings and tray.
- Automatic LRCLIB lookup with title/artist/album/duration matching, timestamp
  preference, version-flag penalties (live/remix/acoustic/etc.), instrumental
  detection, LRC validation, timeouts, retries, rate limiting, and local cache.
- Manual `.lrc` import for the current automatic track.
- Automatic overlay: borderless fullscreen, pure black, existing constellation
  renderer, no persistent chrome. Temporary track pill only on pointer move/H.
- Real player-position synchronization by extrapolating SMTC samples; seeks are
  picked up on the next metadata sample; pause/resume and track changes update
  without restarting the app.
- Space freezes only the visual clock in automatic mode; the external player is
  never controlled.
- Esc exits the overlay and dismisses the current track until it resumes or
  changes.
- Tray-resident lifecycle: Start/Stop, Preview, player selection, Settings, Exit.
- Settings window on demand; closing it hides it and keeps automatic mode alive.
- Player-close detection: the overlay hides after the exit grace period.
- Windows loopback capture for edge-light levels, analysed in memory only, with
  graceful fallback to metadata-only levels if capture fails.
- Manual mode preserved: local audio + local `.lrc`, offline, reusing the
  original `App`/`Experience`/`AudioService`.
- Separate identity and storage:
  - product `AfterGlowV2`
  - app id `com.pxjuzz.afterglowv2`
  - executable `afterglowv2.exe`
  - user data `%APPDATA%\AfterGlowV2`
  - settings `auto-settings.json`
  - cache `lyrics-cache.json`
  - manual database `afterglow.sqlite`
- No telemetry; online lyrics are opt-out via settings.
- Installer and portable ZIP built for Windows x64.

## Limited or intentionally unsupported features

- **System-wide loopback, not per-process capture.** Chromium/Electron does not
  expose a per-process WASAPI capture path. The overlay reacts to the system mix.
- **No audio fingerprinting.** There is no permitted fingerprint service wired
  in, so matching relies on SMTC metadata.
- **No streaming-service private APIs.** Spotify/Apple Music/etc. are observed
  only through Windows media sessions.
- **No global toggle hotkey.** Start/stop is in the tray and settings window, so
  the app does not install a system-wide keyboard hook.
- **SMTC accuracy is player-dependent.** Position updates and metadata quality
  vary by player; the app does not claim audio-analysis precision.
- **Notification heuristic is conservative, not perfect.** A very short real
  track or a metadata-poor player can be skipped.
- **Manual overlay IPC path (`auto:open-manual`) is available but not used by the
  visible UI.** The Manual tab uses the original `App` directly.

## Test and build results

All commands were run in `C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2`.

### Lint / typecheck

```text
npm run lint
> tsc --noEmit && eslint .
(no errors)
```

### Unit + integration tests

```text
npm test
Test Files  14 passed (14)
Tests       101 passed (101)
```

New coverage includes:

- automatic settings sanitization, persistence, corruption recovery,
- SMTC line parsing, session normalization, fake monitor behavior,
- a real PowerShell/WinRT helper smoke test (Windows only),
- LRCLIB matching/scoring/version handling/validation/errors/404,
- lyrics cache keys, expiry, persistence, corruption recovery,
- engine entry/exit/pause/track-change/dismissal/manual-lyrics/capture behavior,
- loopback capture and packaged smoke coverage in Playwright.

### End-to-end tests

```text
npm run test:e2e
Running 4 tests using 1 worker
ok 1 tests\e2e\afterglow.spec.ts — original manual setup, fullscreen, keyboard, re-entry
ok 2 tests\e2e\auto.spec.ts — automatic mode, notification gate, overlay, pause/resume, track change
ok 3 tests\e2e\auto.spec.ts — Windows loopback capture starts for the overlay
ok 4 tests\e2e\packaged.spec.ts — packaged executable smoke test
4 passed
```

The packaged smoke test launched the real
`out\AfterGlowV2-win32-x64\afterglowv2.exe` through the Chrome DevTools
protocol, selected files, entered fullscreen, played, exited, and closed.

### Packaging

```text
npm run make
✔ Making a squirrel distributable for win32/x64
✔ Making a zip distributable for win32/x64
✔ Making distributables
```

Artifacts are listed under **Paths** above.

### Original project verification

The original project was not modified:

```text
cd C:\Users\PRAJWAL\OneDrive\Desktop\afterglow
git status --porcelain   -> (empty)
git log -1 --oneline     -> ad7979b Release 1.0.1
npm run lint             -> pass
npm test                 -> 8 files, 54 tests passed
```

No build was run in the original directory, to avoid writing into it.

## How to launch the original independently

```powershell
cd C:\Users\PRAJWAL\OneDrive\Desktop\afterglow
npm run dev
```

Or run the original packaged executable from its own `out` directory. The
original and AfterGlowV2 have separate executables, app ids, and user-data
folders, so they can coexist.

## Honest testing notes

- The real SMTC helper was tested on this machine: it starts, emits a valid
  JSON line, and stops cleanly. No external player was left playing during the
  final automated run, so the automated integration test exercises the idle
  session shape rather than a live third-party player.
- The automatic overlay transitions were tested with the fake media monitor and
  a local LRC file, which drives the same engine and renderer paths as real
  SMTC input.
- LRCLIB was validated with a real Queen query during development; the committed
  unit tests mock the network so they are deterministic.
- Loopback capture was verified to reach `active` in the Electron overlay on
  this machine. Device switching and multi-device edge cases were not
  exhaustively tested.
- The Squirrel installer was built but the interactive installation wizard was
  not run as part of this report; the unpacked packaged executable was launched
  and smoke-tested.
- The original project's own tests and lint were re-run, but its packaged build
  was not rebuilt during this work.
