import type { AppSettings } from '@shared/ipc';
import { clamp } from '@/lib/format';

interface ExperienceOptionsProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function ExperienceOptions({ settings, onChange }: ExperienceOptionsProps) {
  return (
    <details className="options group">
      <summary>
        <span className="text-[rgba(155,107,255,0.55)]">+</span>
        EXPERIENCE OPTIONS
      </summary>
      <div className="option-grid">
        <label>
          <span className="field-label">
            Lyric offset
            <span className="field-value">
              {settings.offsetMs > 0 ? '+' : ''}
              {settings.offsetMs} ms
            </span>
          </span>
          <input
            className="input-control"
            data-testid="offset-input"
            type="number"
            min={-5000}
            max={5000}
            step={50}
            value={settings.offsetMs}
            onChange={(event) =>
              onChange({
                offsetMs: clamp(Math.round(Number(event.target.value) || 0), -5000, 5000),
              })
            }
          />
        </label>

        <label>
          <span className="field-label">
            Animation intensity
            <span className="field-value">{Math.round(settings.intensity * 100)}%</span>
          </span>
          <input
            className="range-control"
            type="range"
            min={0.4}
            max={1.4}
            step={0.05}
            value={settings.intensity}
            onChange={(event) => onChange({ intensity: Number(event.target.value) })}
            aria-label="Animation intensity"
          />
        </label>

        <label>
          <span className="field-label">Motion</span>
          <select
            className="select-control"
            value={settings.reducedMotion}
            onChange={(event) =>
              onChange({
                reducedMotion: event.target.value as AppSettings['reducedMotion'],
              })
            }
          >
            <option value="auto">Follow Windows</option>
            <option value="on">Reduced motion</option>
            <option value="off">Full motion</option>
          </select>
        </label>

        <label>
          <span className="field-label">Word reveal</span>
          <select
            className="select-control"
            value={settings.wordReveal}
            onChange={(event) =>
              onChange({ wordReveal: event.target.value as AppSettings['wordReveal'] })
            }
          >
            <option value="sequential">Sequential</option>
            <option value="even">Even</option>
          </select>
        </label>

        <label>
          <span className="field-label">Arrangement</span>
          <select
            className="select-control"
            data-testid="style-select"
            value={settings.constellationStyle}
            onChange={(event) =>
              onChange({
                constellationStyle: event.target.value as AppSettings['constellationStyle'],
              })
            }
          >
            <option value="constellation">Constellation</option>
            <option value="starfield">Starfield</option>
            <option value="kinetic">Kinetic</option>
          </select>
        </label>

        <label className="flex flex-col justify-end">
          <span className="field-label">Temporary controls</span>
          <span className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.temporaryControls}
              onChange={(event) => onChange({ temporaryControls: event.target.checked })}
            />
            Reveal briefly with mouse or H
          </span>
        </label>
      </div>
      <p className="mt-4 text-center text-[9px] leading-relaxed tracking-[0.04em] text-[rgba(164,154,184,0.48)]">
        Positive offset delays the lyrics. Settings and both files return when you press Escape.
      </p>
    </details>
  );
}
