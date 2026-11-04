# AfterGlowV2

**Every song still creates its own universe — now it can find the song by itself.**

AfterGlowV2 is the successor to
[AFTERGLOW v1.0.1](https://github.com/Pxjjuzz/AFTERGLOW/tree/v1.0.1). It keeps
the same purple constellation renderer, LRC parser, lyric timeline, animation
engine, and fullscreen interaction, and adds an automatic Windows mode:

- watches Windows media sessions (SMTC) for whatever is playing,
- matches timestamped lyrics through [LRCLIB](https://lrclib.net/),
- opens a borderless, pure-black fullscreen constellation overlay only when
  lyrics are ready,
- returns to the desktop after playback stops, and
- lives in the system tray when no scene is on screen.

The original AFTERGLOW project is untouched and can still be launched on its
own. AfterGlowV2 uses its own executable, app id, user-data folder, caches, and
settings.

---

## Requirements

- Windows 10 or Windows 11, x64.
- A media player that exposes Windows System Media Transport Controls (SMTC):
  Spotify, Apple Music, foobar2000 with a media-session component, MusicBee,
  VLC (recent versions), Windows Media Player, browsers playing media, etc.
- PowerShell 5.1 (included with Windows) for the WinRT media-session bridge.
- Network access only when **Look up timestamped lyrics on LRCLIB** is enabled.

## Run

Development:

```powershell
cd C:\Users\PRAJWAL\OneDrive\Desktop\AfterGlowV2
npm install
npm run dev
```

Packaged build:

```powershell
npm run make
```

Artifacts:

- Installer:
  `out\make\squirrel.windows\x64\AfterGlowV2-2.0.0 Setup.exe`
- Portable unpacked app:
  `out\AfterGlowV2-win32-x64\afterglowv2.exe`
- ZIP:
  `out\make\zip\win32\x64\AfterGlowV2-win32-x64-2.0.0.zip`

Launch with `--hidden` (or `AFTERGLOWV2_START_HIDDEN=1`) to start directly in
the tray without showing the settings window.

## Two ways to use it

### Automatic

1. Start playback in a supported Windows player.
2. AfterGlowV2 reads the title, artist, album, duration, status, and position
   from the Windows media session.
3. It searches LRCLIB for a confident timestamped match.
4. Once lyrics are ready and the entry delay has elapsed, the overlay opens.
5. Pause, resume, seek, track changes, and player exit are followed using the
   player's own metadata.

The overlay never controls the player. It only observes.

### Manual

The **MANUAL** tab is the original AFTERGLOW flow: choose a local audio file and
an `.lrc` file, then enter the fullscreen experience. This works completely
offline and reuses the original `App`, `Experience`, `AudioService`, renderer,
and keyboard handling.

## Controls

| Input | Automatic overlay | Manual experience |
| --- | --- | --- |
| `Esc` | Leave the visual scene (automatic mode keeps listening) | Leave fullscreen and return to setup |
| `Space` | Freeze/resume the visual clock only; the external player is untouched | Pause/resume the local audio (original behavior) |
| `H` | Show/hide the temporary track pill | Show/hide the original temporary controls |
| Arrow keys | Not intercepted | Seek the local audio by five seconds |
| Pointer move | Reveals the temporary track pill for three seconds | Reveals the original controls |

When no overlay is visible, AfterGlowV2 does not register a global keyboard
hook and does not intercept keys.

## Tray menu

- **Start/Stop automatic mode**
- **Preview overlay**
- **Monitored player** — all players or one specific SMTC source
- **Settings…**
- **Exit AfterGlowV2**

Closing the settings window hides it; the app stays in the tray so automatic
mode can continue. Use the tray **Exit** item or the settings footer **EXIT**
button to quit fully.

## Settings

- Automatic mode on/off.
- Monitored player (all players or one source).
- Entry delay before the overlay opens.
- Exit grace period after playback stops.
- Pause delay and pause behavior (`keep` the scene or `hide` it).
- LRCLIB online lookups on/off.
- Windows loopback level capture on/off.
- Temporary track pill on/off.
- Manual `.lrc` import for the current automatic track.
- Manual local audio + LRC experience.

Settings are stored in `%APPDATA%\AfterGlowV2\auto-settings.json`. The manual
workflow keeps its SQLite database in the same folder as
`afterglow.sqlite`. Lyrics are cached in `lyrics-cache.json`.

## How it works

```text
Windows SMTC (PowerShell + WinRT)
        │  title / artist / album / status / position / duration
        ▼
  SmtcMonitor ──► AutoEngine ──► LyricsService ──► LRCLIB
        │              │               │
        │              │               └── LyricsCache (local JSON)
        │              ▼
        │        Overlay window (borderless fullscreen, black)
        │              │
        │              ├── ConstellationRenderer (reused)
        │              ├── LyricTimeline + LRC parser (reused)
        │              └── loopback analyser (in-memory levels only)
        ▼
  Settings window / tray
```

Key modules:

- `electron/media/smtcScript.ts` — embedded PowerShell/WinRT helper.
- `electron/media/smtcMonitor.ts` — long-running helper process, JSON-line
  parser, fake monitor for tests.
- `electron/lyrics/lrclib.ts` — LRCLIB client, matching, scoring, validation,
  rate limiting, retries, timeouts.
- `electron/lyrics/lyricsCache.ts` — local cache with expiry.
- `electron/lyrics/service.ts` — provider orchestration and manual fallback.
- `electron/auto/engine.ts` — entry/exit/pause/track-change state machine.
- `electron/auto/autoSettings.ts` — atomic JSON settings store.
- `electron/main.ts` — tray, settings window, overlay window, display-media
  loopback handler, lifecycle.
- `src/auto/AutoExperience.tsx` — automatic overlay using the real renderer.
- `src/auto/useRemotePlayback.ts` — extrapolated SMTC clock and visual pause.
- `src/auto/useLoopbackCapture.ts` — in-memory loopback analyser.
- `src/auto/ManualOverlay.tsx` — manual overlay reusing the original
  `Experience`.
- `src/auto/SettingsApp.tsx` — automatic/manual settings UI.

## Privacy and network use

- **No audio is recorded.** Loopback audio is analysed in memory only to drive
  the edge lighting. Nothing is written to disk.
- **No telemetry.**
- **No streaming-service account integration.** Spotify/Apple Music/etc. are
  only observed through Windows media sessions; their private APIs are not used.
- **LRCLIB is the only online lyrics provider.** Lookups happen only when
  online lyrics are enabled. The request sends the track title, artist, album,
  and no account credentials.
- The Windows media-session helper reads local playback metadata through WinRT.
  It does not control the player.
- The app never changes the desktop wallpaper. The overlay is a normal
  borderless fullscreen window.

Review LRCLIB's terms and your local network policy before enabling online
lookups in a managed environment.

## Limitations

- **System-wide loopback, not per-process capture.** Chromium/Electron exposes
  WASAPI loopback for the selected screen, not a single process. The overlay
  therefore reacts to the overall system mix. If capture fails, the app falls
  back to metadata-only levels and keeps working.
- **No audio fingerprinting.** Matching relies on SMTC title/artist/album/
  duration. If a player exposes poor metadata, the lookup may miss.
- **Position comes from SMTC metadata.** It is extrapolated between samples, not
  derived from audio analysis. Some players update position infrequently or not
  at all; seek detection is therefore limited by the player's reporting rate.
- **Notification-sound filtering is heuristic.** Tracks shorter than 20 seconds
  are ignored, and metadata-poor sessions without an artist or duration are
  treated as notification sounds. A very short real track can be skipped.
- **No global toggle hotkey.** Start/stop is available from the tray and the
  settings window. This avoids a system-wide keyboard hook.
- **No restricted streaming lyrics integrations.** Only LRCLIB is bundled.
- **Manual overlay via `auto:open-manual`** exists in the IPC/preload layer, but
  the visible UI uses the original `App` in the Manual tab. The manual overlay
  window path is available for future integrations.

## Development

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # tsc --noEmit && eslint .
npm test            # Vitest unit + integration tests
npm run test:e2e    # package, then Playwright Electron tests
npm run make        # installer + zip
```

The test suite uses isolated user-data folders:

- `AFTERGLOWV2_USER_DATA` — temporary user-data directory.
- `AFTERGLOWV2_FAKE_MEDIA` — JSON file that drives the fake SMTC monitor.
- `AFTERGLOWV2_FAKE_LYRICS` — local `.lrc` file used instead of LRCLIB.

Tests cover:

- settings sanitization and atomic persistence,
- SMTC line parsing and normalization,
- a real PowerShell/WinRT helper smoke test (Windows only),
- LRCLIB matching, scoring, version handling, validation, errors, and 404s,
- lyrics cache keys, expiry, persistence, and corruption recovery,
- engine entry/exit/pause/track-change/dismissal/manual-lyrics behavior,
- the original manual fullscreen flow,
- the automatic overlay flow with fake media and lyrics,
- Windows loopback capture starting for the overlay,
- the packaged executable smoke test.

## Original AFTERGLOW

The v1.0.1 source is preserved in this repository's history:

<https://github.com/Pxjjuzz/AFTERGLOW/tree/v1.0.1>

A local sibling checkout can still be launched independently with:

```powershell
cd C:\Users\PRAJWAL\OneDrive\Desktop\afterglow
npm run dev
```

or by running its packaged executable from its own `out` directory.
AfterGlowV2 does not depend on the original project at runtime.

## License

MIT. See `LICENSE`.
