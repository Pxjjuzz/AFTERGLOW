import { useEffect, useState } from 'react';
import type { AudioService } from '@/services/audio/AudioService';
import { usePlaybackStore } from '@/stores/playbackStore';
import { formatTime } from '@/lib/format';

interface TemporaryControlsProps {
  service: AudioService | null;
  visible: boolean;
  onSeek: () => void;
}

export function TemporaryControls({ service, visible, onSeek }: TemporaryControlsProps) {
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!visible || !service) return;
    const frame = window.requestAnimationFrame(() => setCurrentTime(service.currentTime));
    const timer = window.setInterval(() => {
      setCurrentTime(service.currentTime);
    }, 220);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [visible, service]);

  const duration = service?.duration ?? 0;
  const max = duration > 0 ? duration : 1;

  return (
    <div
      className="temporary-controls"
      data-visible={visible}
      data-temporary-controls="true"
      data-testid="temporary-controls"
      aria-hidden={!visible}
    >
      <button
        type="button"
        className="control-button"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        tabIndex={visible ? 0 : -1}
        onClick={() => {
          if (!service) return;
          void service.toggle().catch(() => undefined);
        }}
      >
        {isPlaying ? (
          <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="2.1" height="8" rx="0.5" fill="currentColor" />
            <rect x="5.9" y="1" width="2.1" height="8" rx="0.5" fill="currentColor" />
          </svg>
        ) : (
          <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true">
            <path d="M1.4 1.1L8 5L1.4 8.9V1.1Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <span className="control-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <input
        className="control-progress"
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={Math.min(currentTime, max)}
        tabIndex={visible ? 0 : -1}
        aria-label="Seek through the song"
        onChange={(event) => {
          if (!service) return;
          service.seekTo(Number(event.target.value));
          setCurrentTime(service.currentTime);
          onSeek();
        }}
      />
    </div>
  );
}
