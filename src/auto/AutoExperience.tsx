import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayPayload } from '@shared/ipc';
import { ConstellationRenderer } from '@/features/constellation/ConstellationRenderer';
import { parseLrc } from '@/features/lyrics/lrcParser';
import { LyricTimeline } from '@/features/lyrics/timeline';
import { useLoopbackCapture } from './useLoopbackCapture';
import { useRemotePlayback } from './useRemotePlayback';

interface AutoExperienceProps {
  payload: OverlayPayload;
}

export function AutoExperience({ payload }: AutoExperienceProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ConstellationRenderer | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [liveLine, setLiveLine] = useState('');
  const [controlsVisible, setControlsVisible] = useState(false);

  const timeline = useMemo(() => {
    const parsed = parseLrc(payload.lyrics.lrc);
    if (!parsed.ok) return null;
    const durationMs =
      payload.track.duration > 0
        ? payload.track.duration * 1000
        : payload.lyrics.matchedDuration > 0
          ? payload.lyrics.matchedDuration * 1000
          : 0;
    return new LyricTimeline(parsed.lyrics, {
      durationMs,
      offsetMs: 0,
      wordReveal: 'sequential',
    });
  }, [payload.lyrics.lrc, payload.track.duration, payload.lyrics.matchedDuration]);

  const remote = useRemotePlayback(payload.track);
  const capture = useLoopbackCapture(Boolean(payload.captureAudio));

  const levels = useCallback(
    () =>
      payload.captureAudio && capture.status === 'active'
        ? capture.levelsRef.current
        : remote.levelsRef.current,
    [capture.levelsRef, capture.status, payload.captureAudio, remote.levelsRef],
  );

  const revealControls = useCallback(() => {
    if (!payload.overlayControls) return;
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideTimerRef.current = null;
    }, 3000);
  }, [payload.overlayControls]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !timeline) return;
    const renderer = new ConstellationRenderer({
      canvas,
      timeline,
      style: payload.style,
      intensity: payload.intensity,
      reducedMotion: payload.reducedMotion,
      sample: remote.sample,
      levels,
      onLineChange: (_index, line) => {
        setLiveLine(line?.text ?? '');
      },
    });
    rendererRef.current = renderer;
    renderer.start();
    renderer.setPlaying(remote.playback.playing && !remote.visualPaused);
    const focusFrame = requestAnimationFrame(() => stageRef.current?.focus());

    return () => {
      cancelAnimationFrame(focusFrame);
      renderer.destroy();
      rendererRef.current = null;
    };
    // `remote.playback` changes constantly; it is applied in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, payload.style, payload.intensity, payload.reducedMotion, remote.sample, levels]);

  useEffect(() => {
    rendererRef.current?.setPlaying(remote.playback.playing && !remote.visualPaused);
  }, [remote.playback.playing, remote.visualPaused]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void window.afterglow.auto.exitOverlay();
        return;
      }
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (event.repeat) return;
        remote.toggleVisual();
        revealControls();
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        if (!payload.overlayControls) return;
        event.preventDefault();
        setControlsVisible((visible) => !visible);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [payload.overlayControls, remote, revealControls]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!timeline) {
    return (
      <div className="auto-overlay-blank" data-testid="auto-experience-error">
        <p className="notice-band">The lyrics for this track could not be read.</p>
        <button
          type="button"
          className="auto-button"
          onClick={() => void window.afterglow.auto.exitOverlay()}
        >
          RETURN TO THE DESKTOP
        </button>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="experience-stage auto-experience-stage"
      data-testid="auto-experience"
      data-visual-paused={remote.visualPaused}
      data-track-key={payload.track.key}
      data-ui-visible={controlsVisible}
      tabIndex={-1}
      role="main"
      aria-label="AfterGlowV2 automatic constellation lyrics"
      onPointerMove={revealControls}
      onPointerDown={() => stageRef.current?.focus()}
    >
      <canvas
        ref={canvasRef}
        className="experience-canvas"
        data-testid="auto-experience-canvas"
        aria-hidden="true"
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveLine}
      </div>
      {payload.overlayControls ? (
        <div
          className="temporary-controls auto-track-pill"
          data-testid="auto-track-pill"
          data-visible={controlsVisible}
        >
          <div className="auto-pill-track">
            <span className="auto-pill-title" data-testid="auto-track-title">
              {payload.track.title || 'Unknown track'}
            </span>
            <span className="auto-pill-meta">
              {payload.track.artist || 'Unknown artist'}
              {payload.track.album ? ` · ${payload.track.album}` : ''}
            </span>
          </div>
          <span className="auto-pill-state" data-testid="auto-pill-state">
            {remote.visualPaused
              ? 'VISUAL PAUSED'
              : remote.playback.playing
                ? 'LIVE'
                : 'PLAYER PAUSED'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
