import { useEffect, useState } from 'react';
import type { OverlayPayload } from '@shared/ipc';
import { AutoExperience } from './AutoExperience';
import { ManualOverlay } from './ManualOverlay';

/**
 * The overlay window is intentionally almost empty: a pure black surface that
 * only ever mounts the constellation renderer. All chrome lives in the separate
 * settings window, so nothing can appear on top of the desktop experience.
 */
export function OverlayApp() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.afterglow.auto
      .getOverlay()
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const unsubscribe = window.afterglow.auto.onOverlay((next) => {
      if (cancelled) return;
      setPayload(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // If the main process hides the window while a key is held, make sure no
  // stale focus trap remains. The overlay never intercepts keys when blank.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (payload) return;
      event.preventDefault();
      void window.afterglow.auto.exitOverlay();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [payload]);

  if (!payload) {
    return (
      <div
        className="auto-overlay-blank"
        data-testid="auto-overlay-blank"
        data-ready={ready}
        aria-hidden="true"
      />
    );
  }

  if (payload.mode === 'manual') {
    return <ManualOverlay key={payload.track.key} payload={payload} />;
  }

  return <AutoExperience key={payload.track.key} payload={payload} />;
}
