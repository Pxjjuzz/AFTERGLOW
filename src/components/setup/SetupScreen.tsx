import type { AppSettings, SelectedFile } from '@shared/ipc';
import type { ParsedLyrics } from '@/features/lyrics/lrcParser';
import { ConstellationMark } from './ConstellationMark';
import { DropZone } from './DropZone';
import { ExperienceOptions } from './ExperienceOptions';
import { formatBytes } from '@/lib/format';

interface SetupScreenProps {
  audioFile: SelectedFile | null;
  lyricsFile: SelectedFile | null;
  lyrics: ParsedLyrics | null;
  settings: AppSettings;
  audioError: string | null;
  lyricsError: string | null;
  experienceError: string | null;
  notice: string | null;
  isEntering: boolean;
  canEnter: boolean;
  version: string;
  onPickAudio: () => void;
  onPickLyrics: () => void;
  onDropAudio: (file: File) => void;
  onDropLyrics: (file: File) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onEnter: () => void;
}

function lyricsMeta(lyrics: ParsedLyrics): string {
  const parts: string[] = [];
  if (lyrics.metadata.title) parts.push(lyrics.metadata.title);
  if (lyrics.metadata.artist) parts.push(lyrics.metadata.artist);
  parts.push(`${lyrics.lineCount} ${lyrics.lineCount === 1 ? 'line' : 'lines'}`);
  if (lyrics.warnings.length > 0) {
    parts.push(`${lyrics.warnings.length} skipped`);
  }
  return parts.join(' · ');
}

export function SetupScreen(props: SetupScreenProps) {
  const {
    audioFile,
    lyricsFile,
    lyrics,
    settings,
    audioError,
    lyricsError,
    experienceError,
    notice,
    isEntering,
    canEnter,
    version,
    onPickAudio,
    onPickLyrics,
    onDropAudio,
    onDropLyrics,
    onSettingsChange,
    onEnter,
  } = props;

  return (
    <div className="setup-scroll" data-testid="setup-screen">
      <div className="titlebar-drag" />
      <div className="setup-shell">
        <div className="mx-auto flex min-h-full w-full max-w-[800px] flex-col px-6 pb-9 pt-[74px] sm:px-8 sm:pt-[86px]">
          <header className="flex flex-col items-center text-center">
            <ConstellationMark />
            <h1 className="wordmark mt-5">AFTERGLOW</h1>
            <p className="tagline mt-3.5">Every song creates its own universe.</p>
          </header>

          <main className="mt-11 w-full self-center sm:mt-12">
            <div className="drop-grid">
              <DropZone
                kind="audio"
                file={audioFile}
                statusText={
                  audioFile
                    ? `${audioFile.extension.replace('.', '').toUpperCase()} · ${formatBytes(audioFile.size)}`
                    : undefined
                }
                error={audioError}
                onPick={onPickAudio}
                onFile={onDropAudio}
              />
              <DropZone
                kind="lyrics"
                file={lyricsFile}
                statusText={lyrics ? lyricsMeta(lyrics) : undefined}
                error={lyricsError}
                onPick={onPickLyrics}
                onFile={onDropLyrics}
              />
            </div>

            <div className="mt-4 min-h-[14px]">
              {notice ? (
                <p className="notice-band text-center" role="status">
                  {notice}
                </p>
              ) : null}
              {experienceError ? (
                <p className="error-band mt-2 text-center" role="alert">
                  {experienceError}
                </p>
              ) : null}
            </div>

            <div className="mx-auto mt-5 w-full max-w-[390px]">
              <button
                type="button"
                className="primary-button"
                data-testid="enter-experience"
                disabled={!canEnter}
                onClick={onEnter}
              >
                {isEntering ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    PREPARING THE UNIVERSE
                  </>
                ) : (
                  <>
                    <span
                      className="text-[11px] text-[rgba(220,203,255,0.9)]"
                      aria-hidden="true"
                    >
                      ✦
                    </span>
                    ENTER THE EXPERIENCE
                  </>
                )}
                <span className="enter-shimmer" aria-hidden="true" />
              </button>
              <p
                className="mt-4 text-center text-[9.5px] leading-relaxed tracking-[0.1em] text-[rgba(164,154,184,0.52)]"
                aria-live="polite"
              >
                {isEntering
                  ? 'Loading the audio and opening fullscreen.'
                  : canEnter
                    ? 'FULLSCREEN · SPACE PAUSES · ESC RETURNS'
                    : 'SELECT AN AUDIO FILE AND ITS LRC LYRICS TO BEGIN'}
              </p>
            </div>

            <div className="mx-auto mt-9 w-full max-w-[580px]">
              <ExperienceOptions settings={settings} onChange={onSettingsChange} />
            </div>
          </main>

          <footer className="mt-auto flex items-center justify-between gap-4 pt-10 text-[8px] font-semibold tracking-[0.2em] text-[rgba(164,154,184,0.34)]">
            <span>AFTERGLOW {version}</span>
            <span>LOCAL · OFFLINE</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
