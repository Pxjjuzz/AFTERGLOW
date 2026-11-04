import { useEffect, useRef, useState } from 'react';
import type { OverlayPayload } from '@shared/ipc';
import type { ExperienceSession } from '@/app/types';
import { Experience } from '@/components/experience/Experience';
import { parseLrc } from '@/features/lyrics/lrcParser';
import { LyricTimeline } from '@/features/lyrics/timeline';
import { AudioService } from '@/services/audio/AudioService';

interface ManualOverlayProps {
  payload: OverlayPayload;
}

/**
 * Manual mode reuses the original AFTERGLOW Experience verbatim: same audio
 * service, same renderer, same keyboard contract. The only difference is that
 * it lives in the borderless overlay window.
 */
export function ManualOverlay({ payload }: ManualOverlayProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [service, setService] = useState<AudioService | null>(null);
  const [session, setSession] = useState<ExperienceSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    let cancelled = false;
    const audioService = new AudioService(element);
    setService(audioService);

    const parsed = parseLrc(payload.lyrics.lrc);
    if (!parsed.ok) {
      setError(parsed.error.message);
      return () => {
        audioService.destroy();
      };
    }

    const url = payload.mediaUrl;
    if (!url) {
      setError('The prepared audio source is missing.');
      return () => {
        audioService.destroy();
      };
    }

    void audioService
      .load(url)
      .then((duration) => {
        if (cancelled) return;
        const timeline = new LyricTimeline(parsed.lyrics, {
          durationMs: duration * 1000,
          offsetMs: 0,
          wordReveal: 'sequential',
        });
        setSession({
          timeline,
          mediaToken: payload.mediaToken ?? '',
          style: payload.style,
          intensity: payload.intensity,
          reducedMotion: payload.reducedMotion,
          temporaryControls: payload.overlayControls,
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'The audio could not be loaded.');
      });

    return () => {
      cancelled = true;
      audioService.destroy();
      const token = payload.mediaToken;
      if (token) void window.afterglow.media.release(token).catch(() => undefined);
    };
  }, [
    payload.lyrics.lrc,
    payload.mediaToken,
    payload.mediaUrl,
    payload.style,
    payload.intensity,
    payload.reducedMotion,
    payload.overlayControls,
  ]);

  if (error) {
    return (
      <div className="auto-overlay-blank" data-testid="auto-overlay-error">
        <p className="notice-band">{error}</p>
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
    <div className="manual-overlay" data-testid="manual-overlay">
      <audio ref={audioRef} className="hidden" aria-hidden="true" />
      {session && service ? (
        <Experience
          session={session}
          service={service}
          onExited={() => {
            void window.afterglow.auto.exitOverlay();
          }}
          onFatalError={(message) => {
            setError(message);
            void window.afterglow.auto.exitOverlay();
          }}
        />
      ) : (
        <div className="auto-overlay-blank" data-testid="manual-loading">
          <span className="spinner" aria-hidden="true" />
          <p className="notice-band">Preparing the manual experience…</p>
        </div>
      )}
    </div>
  );
}
