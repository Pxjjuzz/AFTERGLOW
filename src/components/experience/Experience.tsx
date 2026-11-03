import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExperienceSession } from '@/app/types';
import type { AudioService } from '@/services/audio/AudioService';
import { ConstellationRenderer } from '@/features/constellation/ConstellationRenderer';
import { TemporaryControls } from './TemporaryControls';

interface ExperienceProps {
  session: ExperienceSession;
  service: AudioService | null;
  onExited: () => void;
  onFatalError: (message: string) => void;
}

export function Experience({ session, service, onExited, onFatalError }: ExperienceProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ConstellationRenderer | null>(null);
  const exitingRef = useRef(false);
  const fatalRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const [liveLine, setLiveLine] = useState('');
  const [controlsVisible, setControlsVisible] = useState(false);

  const onExitedRef = useRef(onExited);
  const onFatalRef = useRef(onFatalError);
  useEffect(() => {
    onExitedRef.current = onExited;
    onFatalRef.current = onFatalError;
  }, [onExited, onFatalError]);

  const revealControls = useCallback(() => {
    if (!session.temporaryControls) return;
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideTimerRef.current = null;
    }, 2800);
  }, [session.temporaryControls]);

  const hideControls = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setControlsVisible(false);
  }, []);

  const handleExit = useCallback(
    async (alreadyLeftFullscreen = false) => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      hideControls();
      service?.pause();
      rendererRef.current?.setPlaying(false);
      if (!alreadyLeftFullscreen) {
        try {
          await window.afterglow.experience.exit();
        } catch {
          // Even if Windows refuses the transition, return to the doorway in a
          // predictable, paused state rather than trapping the user.
        }
      }
      onExitedRef.current();
    },
    [hideControls, service],
  );

  const fail = useCallback(
    (message: string) => {
      if (fatalRef.current || exitingRef.current) return;
      fatalRef.current = true;
      hideControls();
      service?.pause();
      rendererRef.current?.setPlaying(false);
      onFatalRef.current(message);
    },
    [hideControls, service],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !service) return;
    const renderer = new ConstellationRenderer({
      canvas,
      timeline: session.timeline,
      style: session.style,
      intensity: session.intensity,
      reducedMotion: session.reducedMotion,
      sample: () => ({
        time: service.currentTime,
        playing: service.isPlaying,
        ended:
          !service.isPlaying &&
          service.duration > 0 &&
          service.currentTime >= service.duration - 0.05,
      }),
      onLineChange: (_index, line) => {
        setLiveLine(line?.text ?? '');
      },
    });
    rendererRef.current = renderer;

    const unsubscribe = service.subscribe((snapshot) => {
      renderer.setPlaying(snapshot.status === 'playing');
      if (snapshot.status === 'error' && snapshot.error) {
        fail(snapshot.error);
      }
    });
    renderer.start();
    void service.play().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Playback could not start.';
      fail(message);
    });

    const focusFrame = requestAnimationFrame(() => {
      stageRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      unsubscribe();
      renderer.destroy();
      rendererRef.current = null;
      service.pause();
    };
  }, [fail, service, session]);

  useEffect(() => {
    const unsubscribe = window.afterglow.experience.onExitRequested((request) => {
      void handleExit(request.reason === 'os');
    });
    return unsubscribe;
  }, [handleExit]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (exitingRef.current || fatalRef.current) return;
      const target = event.target;
      const insideControls =
        target instanceof Element && target.closest('[data-temporary-controls="true"]');
      const key = event.key;

      if (key === 'Escape') {
        event.preventDefault();
        void handleExit(false);
        return;
      }

      if (insideControls) return;

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (event.repeat || !service) return;
        revealControls();
        void service.toggle().catch((error: unknown) => {
          fail(error instanceof Error ? error.message : 'Playback could not change state.');
        });
        return;
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        if (!service) return;
        service.seekBy(key === 'ArrowLeft' ? -5 : 5);
        if (!service.isPlaying) rendererRef.current?.invalidate();
        revealControls();
        return;
      }

      if (key === 'h' || key === 'H') {
        if (!session.temporaryControls) return;
        event.preventDefault();
        if (event.repeat) return;
        if (controlsVisible) hideControls();
        else revealControls();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controlsVisible, fail, handleExit, hideControls, revealControls, service, session]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleSeekFromControls = (): void => {
    if (service && !service.isPlaying) rendererRef.current?.invalidate();
  };

  return (
    <div
      ref={stageRef}
      className="experience-stage"
      data-testid="experience-screen"
      data-ui-visible={controlsVisible}
      style={{ userSelect: 'none' }}
      tabIndex={-1}
      role="main"
      aria-label="AFTERGLOW constellation lyrics"
      onPointerMove={() => revealControls()}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('[data-temporary-controls="true"]')) return;
        stageRef.current?.focus();
      }}
    >
      <canvas
        ref={canvasRef}
        className="experience-canvas"
        data-testid="experience-canvas"
        aria-hidden="true"
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveLine}
      </div>
      <TemporaryControls
        service={service}
        visible={controlsVisible}
        onSeek={handleSeekFromControls}
      />
    </div>
  );
}
