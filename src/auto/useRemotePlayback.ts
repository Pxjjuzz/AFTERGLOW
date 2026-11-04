import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AutoTrackInfo, PlaybackUpdate } from '@shared/ipc';
import type { PlaybackSample } from '@/features/constellation/ConstellationRenderer';
import { SILENT_SPECTRUM, type SpectrumLevels } from '@/lib/spectrum';

export interface RemotePlayback {
  playback: PlaybackUpdate;
  sample: () => PlaybackSample;
  levelsRef: MutableRefObject<SpectrumLevels>;
  visualPaused: boolean;
  toggleVisual: () => void;
}

/**
 * The automatic overlay never owns the audio element. It extrapolates the
 * player's real position between SMTC samples, and freezes only its own visual
 * clock when Space is pressed.
 */
function initialPlayback(track: AutoTrackInfo): PlaybackUpdate {
  return {
    position: Math.max(0, track.position),
    playing: track.playing,
    duration: track.duration,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    at: 0,
  };
}

export function useRemotePlayback(track: AutoTrackInfo): RemotePlayback {
  const baseRef = useRef<PlaybackUpdate>(initialPlayback(track));
  const levelsRef = useRef<SpectrumLevels>({ ...SILENT_SPECTRUM });
  const pausedRef = useRef(false);
  const frozenRef = useRef(0);
  const keyRef = useRef(track.key);

  const [playback, setPlayback] = useState<PlaybackUpdate>(() => initialPlayback(track));
  const [visualPaused, setVisualPaused] = useState(false);

  const apply = useCallback((update: PlaybackUpdate) => {
    baseRef.current = update;
    levelsRef.current = {
      level: update.level,
      bass: update.bass,
      mid: update.mid,
      treble: update.treble,
    };
    setPlayback(update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.afterglow.auto
      .getPlayback()
      .then((update) => {
        if (!cancelled) apply(update);
      })
      .catch(() => undefined);
    const unsubscribe = window.afterglow.auto.onPlayback(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [apply]);

  useEffect(() => {
    if (keyRef.current === track.key) return;
    keyRef.current = track.key;
    baseRef.current = {
      position: Math.max(0, track.position),
      playing: track.playing,
      duration: track.duration,
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      at: Date.now(),
    };
    pausedRef.current = false;
    frozenRef.current = 0;
    setVisualPaused(false);
    setPlayback(baseRef.current);
    levelsRef.current = { ...SILENT_SPECTRUM };
  }, [track.key, track.position, track.playing, track.duration]);

  const sample = useCallback((): PlaybackSample => {
    const base = baseRef.current;
    const elapsed =
      base.playing && base.at > 0 ? Math.max(0, (Date.now() - base.at) / 1000) : 0;
    const live = Math.max(0, base.position + elapsed);
    const time = pausedRef.current
      ? frozenRef.current
      : base.duration > 0
        ? Math.min(base.duration, live)
        : live;
    return {
      time,
      playing: base.playing && !pausedRef.current,
      ended: base.duration > 0 && time >= base.duration - 0.05,
    };
  }, []);

  const toggleVisual = useCallback(() => {
    if (pausedRef.current) {
      pausedRef.current = false;
      setVisualPaused(false);
      return;
    }
    frozenRef.current = sample().time;
    pausedRef.current = true;
    setVisualPaused(true);
  }, [sample]);

  return { playback, sample, levelsRef, visualPaused, toggleVisual };
}
