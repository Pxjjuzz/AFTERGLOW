import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CaptureStatus } from '@shared/ipc';
import { SILENT_SPECTRUM, averageBand, type SpectrumLevels } from '@/lib/spectrum';

export interface LoopbackCapture {
  status: CaptureStatus;
  error: string | null;
  levelsRef: MutableRefObject<SpectrumLevels>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Windows loopback capture could not start. The overlay will use metadata-only levels.';
}

/**
 * Chromium/Electron exposes WASAPI loopback through getDisplayMedia when the
 * main process answers with `audio: 'loopback'`. The video track is stopped
 * immediately; the audio track is analysed in memory and never recorded.
 */
export function useLoopbackCapture(enabled: boolean): LoopbackCapture {
  const levelsRef = useRef<SpectrumLevels>({ ...SILENT_SPECTRUM });
  const [status, setStatus] = useState<CaptureStatus>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      levelsRef.current = { ...SILENT_SPECTRUM };
      window.afterglow.auto.reportCaptureState({ status: 'off', error: null });
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let timer: number | null = null;

    const report = (next: CaptureStatus, detail: string | null): void => {
      if (cancelled) return;
      setStatus(next);
      setError(detail);
      window.afterglow.auto.reportCaptureState({ status: next, error: detail });
    };

    void (async () => {
      report('starting', null);
      try {
        const media = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        media.getVideoTracks().forEach((track) => track.stop());
        const audioTrack = media.getAudioTracks()[0];
        if (!audioTrack) {
          throw new Error('Windows loopback did not provide an audio track.');
        }

        const audioContext = new AudioContext();
        context = audioContext;
        if (audioContext.state === 'suspended') await audioContext.resume();
        const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        const binHz = audioContext.sampleRate / 2 / data.length;
        const bin = (hz: number): number =>
          Math.max(0, Math.min(data.length - 1, Math.round(hz / binHz)));

        report('active', null);

        timer = window.setInterval(() => {
          analyser.getByteFrequencyData(data);
          const bass = averageBand(data, bin(30), bin(160));
          const mid = averageBand(data, bin(160), bin(2000));
          const treble = averageBand(data, bin(2000), bin(8000));
          const level = Math.min(1, bass * 0.45 + mid * 0.4 + treble * 0.15);
          levelsRef.current = { level, bass, mid, treble };
          window.afterglow.auto.reportAudioLevel(levelsRef.current);
        }, 120);

        audioTrack.addEventListener('ended', () => {
          report('unavailable', 'Windows loopback ended. The player may have closed or changed device.');
        });
      } catch (captureError) {
        const detail = messageOf(captureError);
        report('unavailable', detail);
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (context) {
        void context.close().catch(() => undefined);
        context = null;
      }
      levelsRef.current = { ...SILENT_SPECTRUM };
      window.afterglow.auto.reportCaptureState({ status: 'off', error: null });
    };
  }, [enabled]);

  return {
    status: enabled ? status : 'off',
    error: enabled ? error : null,
    levelsRef,
  };
}
