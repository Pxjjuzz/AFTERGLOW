import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AutoSettings, AutoStatus, LyricsStatus, MediaSessionInfo } from '@shared/ipc';
import { App } from '@/app/App';
import { ConstellationMark } from '@/components/setup/ConstellationMark';

type Tab = 'auto' | 'manual';

const LYRICS_LABEL: Record<LyricsStatus, string> = {
  idle: 'Waiting for a track',
  searching: 'Searching LRCLIB',
  ready: 'Synced lyrics ready',
  'not-found': 'No synced lyrics',
  disabled: 'Online lyrics off',
  error: 'Lyrics lookup failed',
  manual: 'Manual lyrics loaded',
};

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function uniquePlayers(sessions: MediaSessionInfo[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const session of sessions) {
    if (!seen.has(session.id)) seen.set(session.id, session.app || session.id);
  }
  return Array.from(seen, ([id, label]) => ({ id, label }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function SettingsApp() {
  const [tab, setTab] = useState<Tab>('auto');
  const [status, setStatus] = useState<AutoStatus | null>(null);
  const [version, setVersion] = useState('2.0.0');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.afterglow.auto
      .getStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(errorText(error));
      });
    void window.afterglow.app
      .getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => undefined);
    const unsubscribe = window.afterglow.auto.onStatus((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const settings = status?.settings;
  const players = useMemo(() => uniquePlayers(status?.sessions ?? []), [status?.sessions]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<AutoSettings>) => {
      void run(async () => {
        const next = await window.afterglow.auto.updateSettings(patch);
        setStatus(next);
      });
    },
    [run],
  );

  const toggleMonitoring = useCallback(() => {
    void run(async () => {
      const next = status?.monitoring
        ? await window.afterglow.auto.stop()
        : await window.afterglow.auto.start();
      setStatus(next);
    });
  }, [run, status?.monitoring]);

  const refresh = useCallback(() => {
    void run(async () => {
      await window.afterglow.auto.refreshSessions();
      setStatus(await window.afterglow.auto.getStatus());
      setNotice('Player list refreshed.');
    });
  }, [run]);

  const importLyrics = useCallback(() => {
    void run(async () => {
      const result = await window.afterglow.auto.importLyrics();
      setNotice(result.message);
      setStatus(await window.afterglow.auto.getStatus());
    });
  }, [run]);

  const preview = useCallback(() => {
    void run(async () => {
      const result = await window.afterglow.auto.preview();
      if (!result.ok) setNotice(result.message);
    });
  }, [run]);

  const playerOptions = useMemo(() => {
    const list = [...players];
    if (settings?.monitoredPlayer && !list.some((player) => player.id === settings.monitoredPlayer)) {
      list.push({ id: settings.monitoredPlayer, label: settings.monitoredPlayer });
    }
    return list;
  }, [players, settings]);

  return (
    <div className="settings-shell" data-testid="settings-screen">
      <div className="titlebar-drag" />
      <header className="settings-topbar">
        <div className="settings-brand">
          <ConstellationMark />
          <div>
            <div className="wordmark settings-wordmark">AFTERGLOW V2</div>
            <div className="settings-subtitle">AUTOMATIC AMBIENT MODE</div>
          </div>
        </div>
        <nav className="settings-tabs" aria-label="AfterGlowV2 sections">
          <button
            type="button"
            className="settings-tab"
            data-active={tab === 'auto'}
            data-testid="automatic-tab"
            onClick={() => setTab('auto')}
          >
            AUTOMATIC
          </button>
          <button
            type="button"
            className="settings-tab"
            data-active={tab === 'manual'}
            data-testid="manual-tab"
            onClick={() => setTab('manual')}
          >
            MANUAL
          </button>
        </nav>
        <div className="settings-topstatus" data-testid="auto-status" data-monitoring={status?.monitoring}>
          <span
            className="status-dot"
            data-state={
              !status ? 'off' : status.monitoring ? (status.currentTrack ? 'live' : 'idle') : 'off'
            }
          />
          {status?.monitoring ? 'LISTENING' : 'STOPPED'}
        </div>
      </header>

      {tab === 'manual' ? (
        <div className="manual-host" data-testid="manual-panel">
          <App />
        </div>
      ) : (
        <div className="settings-scroll" data-testid="automatic-panel">
          <div className="settings-main">
            <section className="settings-hero">
              <div>
                <p className="settings-eyebrow">WINDOWS MEDIA SESSIONS · LRCLIB</p>
                <h1 className="settings-title">The desktop becomes the universe.</h1>
                <p className="settings-lede">
                  AfterGlowV2 watches the music you already play, matches timestamped lyrics,
                  and opens the constellation overlay only when the words are ready. It never
                  controls your player and never changes your wallpaper.
                </p>
              </div>
              <div className="auto-actions">
                <button
                  type="button"
                  className="auto-button"
                  data-variant="primary"
                  data-testid="auto-toggle-monitoring"
                  disabled={busy}
                  onClick={toggleMonitoring}
                >
                  {status?.monitoring ? 'STOP AUTOMATIC MODE' : 'START AUTOMATIC MODE'}
                </button>
                <button
                  type="button"
                  className="auto-button"
                  data-testid="auto-refresh"
                  disabled={busy}
                  onClick={refresh}
                >
                  REFRESH PLAYERS
                </button>
              </div>
            </section>

            {!status ? (
              <div className="settings-card settings-loading">
                <span className="spinner" aria-hidden="true" />
                Reading the Windows media session bridge…
              </div>
            ) : (
              <>
                <section className="settings-grid">
                  <div className="settings-card">
                    <h2 className="settings-card-title">SYSTEM</h2>
                    <dl className="settings-rows">
                      <div className="settings-row">
                        <dt>Automatic mode</dt>
                        <dd>{status.monitoring ? 'Listening' : 'Stopped'}</dd>
                      </div>
                      <div className="settings-row">
                        <dt>Media sessions</dt>
                        <dd>
                          {status.mediaAvailable
                            ? `${status.sessions.length} visible`
                            : 'Unavailable'}
                        </dd>
                      </div>
                      <div className="settings-row">
                        <dt>Loopback capture</dt>
                        <dd data-testid="auto-capture-status">{status.captureStatus}</dd>
                      </div>
                      <div className="settings-row">
                        <dt>Overlay</dt>
                        <dd>{status.overlayVisible ? 'On screen' : 'Hidden'}</dd>
                      </div>
                      <div className="settings-row">
                        <dt>Version</dt>
                        <dd>{status.version}</dd>
                      </div>
                    </dl>
                    {status.mediaError ? (
                      <p className="error-band mt-3" role="alert">
                        {status.mediaError}
                      </p>
                    ) : null}
                    {status.captureError ? (
                      <p className="notice-band mt-3">{status.captureError}</p>
                    ) : null}
                  </div>

                  <div className="settings-card" data-testid="auto-current-track">
                    <h2 className="settings-card-title">NOW PLAYING</h2>
                    {status.currentTrack ? (
                      <>
                        <p className="auto-track-name" data-testid="auto-current-title">
                          {status.currentTrack.title || 'Untitled'}
                        </p>
                        <p className="auto-track-meta">
                          {status.currentTrack.artist || 'Unknown artist'}
                          {status.currentTrack.album ? ` · ${status.currentTrack.album}` : ''}
                        </p>
                        <div className="auto-badges">
                          <span className="auto-badge">
                            {formatDuration(status.currentTrack.position)} /{' '}
                            {formatDuration(status.currentTrack.duration)}
                          </span>
                          <span className="auto-badge">
                            {status.currentTrack.playing ? 'PLAYING' : 'PAUSED'}
                          </span>
                          <span className="auto-badge">{status.currentTrack.sourceApp}</span>
                        </div>
                      </>
                    ) : (
                      <p className="auto-empty">
                        Play a track in any Windows player that exposes media controls. Notification
                        sounds shorter than 20 seconds are ignored.
                      </p>
                    )}
                    <div className="settings-row settings-row--lyrics">
                      <span>Lyrics</span>
                      <span data-testid="auto-lyrics-status">{LYRICS_LABEL[status.lyricsStatus]}</span>
                    </div>
                    {status.lyricsMessage ? (
                      <p className="notice-band mt-2" data-testid="auto-lyrics-message">
                        {status.lyricsMessage}
                      </p>
                    ) : null}
                    {status.lastError ? (
                      <p className="error-band mt-2" role="alert">
                        {status.lastError}
                      </p>
                    ) : null}
                    <div className="auto-actions auto-actions--inline">
                      <button
                        type="button"
                        className="auto-button"
                        data-testid="auto-import-lyrics"
                        disabled={busy || !status.currentTrack}
                        onClick={importLyrics}
                      >
                        IMPORT .LRC
                      </button>
                      <button
                        type="button"
                        className="auto-button"
                        data-variant="primary"
                        data-testid="auto-preview"
                        disabled={busy || !status.currentTrack}
                        onClick={preview}
                      >
                        PREVIEW OVERLAY
                      </button>
                    </div>
                  </div>
                </section>

                <section className="settings-card">
                  <h2 className="settings-card-title">BEHAVIOUR</h2>
                  <div className="settings-form">
                    <label className="settings-field">
                      <span className="field-label">Monitored player</span>
                      <select
                        className="select-control"
                        data-testid="auto-player-select"
                        value={settings?.monitoredPlayer ?? ''}
                        onChange={(event) => update({ monitoredPlayer: event.target.value })}
                      >
                        <option value="">All players</option>
                        {playerOptions.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="settings-field">
                      <span className="field-label">Pause behaviour</span>
                      <select
                        className="select-control"
                        data-testid="auto-pause-behavior"
                        value={settings?.pauseBehavior ?? 'keep'}
                        onChange={(event) =>
                          update({ pauseBehavior: event.target.value === 'hide' ? 'hide' : 'keep' })
                        }
                      >
                        <option value="keep">Keep the scene visible</option>
                        <option value="hide">Hide after the pause delay</option>
                      </select>
                    </label>

                    <label className="settings-field">
                      <span className="field-label">
                        Entry delay <span className="field-value">{seconds(settings?.entryDelayMs ?? 0)}s</span>
                      </span>
                      <input
                        className="input-control"
                        type="number"
                        min={0}
                        max={60}
                        step={0.5}
                        data-testid="auto-entry-delay"
                        value={seconds(settings?.entryDelayMs ?? 0)}
                        onChange={(event) =>
                          update({ entryDelayMs: Math.max(0, Number(event.target.value) || 0) * 1000 })
                        }
                      />
                    </label>

                    <label className="settings-field">
                      <span className="field-label">
                        Exit grace <span className="field-value">{seconds(settings?.exitDelayMs ?? 0)}s</span>
                      </span>
                      <input
                        className="input-control"
                        type="number"
                        min={0}
                        max={120}
                        step={0.5}
                        data-testid="auto-exit-delay"
                        value={seconds(settings?.exitDelayMs ?? 0)}
                        onChange={(event) =>
                          update({ exitDelayMs: Math.max(0, Number(event.target.value) || 0) * 1000 })
                        }
                      />
                    </label>

                    <label className="settings-field">
                      <span className="field-label">
                        Pause delay <span className="field-value">{seconds(settings?.pauseDelayMs ?? 0)}s</span>
                      </span>
                      <input
                        className="input-control"
                        type="number"
                        min={0}
                        max={60}
                        step={0.5}
                        data-testid="auto-pause-delay"
                        value={seconds(settings?.pauseDelayMs ?? 0)}
                        onChange={(event) =>
                          update({ pauseDelayMs: Math.max(0, Number(event.target.value) || 0) * 1000 })
                        }
                      />
                    </label>
                  </div>

                  <div className="settings-toggles">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        data-testid="auto-online-lyrics"
                        checked={settings?.onlineLyrics ?? true}
                        onChange={(event) => update({ onlineLyrics: event.target.checked })}
                      />
                      Look up timestamped lyrics on LRCLIB
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        data-testid="auto-capture-audio"
                        checked={settings?.captureAudio ?? true}
                        onChange={(event) => update({ captureAudio: event.target.checked })}
                      />
                      Use Windows loopback levels for the edge lighting
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        data-testid="auto-overlay-controls"
                        checked={settings?.overlayControls ?? true}
                        onChange={(event) => update({ overlayControls: event.target.checked })}
                      />
                      Show the temporary track pill in the overlay
                    </label>
                  </div>
                  <p className="settings-footnote">
                    Audio is never recorded. Loopback is analysed in memory only for level data,
                    and no capture is written to disk. The overlay is a separate borderless
                    fullscreen window; your wallpaper is untouched.
                  </p>
                </section>
              </>
            )}

            {notice ? (
              <p className="notice-band settings-notice" role="status" data-testid="settings-notice">
                {notice}
              </p>
            ) : null}

            <footer className="settings-footer">
              <span>AFTERGLOW V2 {version}</span>
              <span>ESC LEAVES THE OVERLAY · SPACE FREEZES THE VISUALS</span>
              <button type="button" className="settings-quit" onClick={() => window.afterglow.auto.quit()}>
                EXIT
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
