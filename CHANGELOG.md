# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Optional global toggle shortcut, kept off by default.
- Multi-device and device-switch coverage for loopback capture.
- End-to-end verification of the Squirrel installer wizard.

## [2.0.0] - 2026-11-04

### Added

- Automatic Windows media-session (SMTC) detection through an embedded
  PowerShell/WinRT helper.
- LRCLIB lookup with title, artist, album, and duration matching; version-flag
  penalties; LRC validation; caching; retries; timeouts; and rate limiting.
- Tray-resident lifecycle with Start/Stop, Preview, player selection, Settings,
  and Exit.
- Borderless, pure-black fullscreen overlay that reuses the existing
  constellation renderer, LRC parser, timeline, and keyboard handling.
- Configurable entry delay, exit grace period, pause delay, and pause behavior.
- Manual `.lrc` import for the current automatic track.
- In-memory WASAPI loopback levels with a graceful metadata-only fallback.
- Unit, integration, and Playwright coverage for the new modules.

### Changed

- Application identity is now `AfterGlowV2`, with its own executable, app id,
  user-data folder, settings, and lyric cache.
- The original manual audio + `.lrc` experience is preserved as the Manual tab.

### Preserved

- The v1.0.1 source remains available at tag `v1.0.1`.
