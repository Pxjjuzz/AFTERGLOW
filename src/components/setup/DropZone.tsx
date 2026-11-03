import { useState, type DragEvent } from 'react';
import type { SelectedFile } from '@shared/ipc';

interface DropZoneProps {
  kind: 'audio' | 'lyrics';
  file: SelectedFile | null;
  statusText?: string;
  error: string | null;
  onPick: () => void;
  onFile: (file: File) => void;
}

function AudioGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 10h1.4M6 7.2v5.6M8.8 4.4v11.2M11.6 7.8v4.4M14.4 5.8v8.4M17 9v2"
        stroke="rgba(220,203,255,0.7)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LyricsGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.2 5.6h11.6M4.2 10h8.8M4.2 14.4h6"
        stroke="rgba(220,203,255,0.7)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="15.6" cy="13.9" r="1.4" stroke="rgba(155,107,255,0.7)" strokeWidth="0.8" />
    </svg>
  );
}

export function DropZone({ kind, file, statusText, error, onPick, onFile }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const label = kind === 'audio' ? 'AUDIO' : 'LYRICS';
  const hint = kind === 'audio' ? 'Drop an audio file' : 'Drop its .lrc lyrics';
  const formats = kind === 'audio' ? 'MP3 · WAV · OGG · FLAC' : 'STANDARD .LRC · UTF-8';

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="dropzone group"
        data-testid={`${kind}-dropzone`}
        data-dragging={dragging}
        data-valid={Boolean(file) && !error}
        data-error={Boolean(error)}
        onClick={onPick}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label={
          file
            ? `Audio file ${file.name}. Click to choose a replacement.`
            : `Choose ${kind === 'audio' ? 'an audio file' : 'an LRC lyrics file'}, or drop it here.`
        }
      >
        <span className="flex w-full items-start justify-between gap-4">
          <span className="flex items-center gap-2.5">
            {kind === 'audio' ? <AudioGlyph /> : <LyricsGlyph />}
            <span className="dropzone-label">{label}</span>
          </span>
          <span className="dropzone-status" data-error={Boolean(error)}>
            {error ? (
              <>
                <span className="h-1 w-1 rounded-full bg-[#e58b9a]" />
                CHECK FILE
              </>
            ) : file ? (
              <>
                <span className="h-1 w-1 rounded-full bg-[#DCCBFF] shadow-[0_0_6px_rgba(220,203,255,0.8)]" />
                READY
              </>
            ) : (
              <>
                <span className="h-1 w-1 rounded-full bg-[rgba(164,154,184,0.4)]" />
                WAITING
              </>
            )}
          </span>
        </span>

        <span className="min-w-0">
          {file ? (
            <>
              <span className="dropzone-filename" title={file.path}>
                {file.name}
              </span>
              <span className="mt-1.5 block text-[10px] tracking-[0.02em] text-[rgba(164,154,184,0.62)]">
                {statusText ?? file.extension.replace('.', '').toUpperCase()}
              </span>
            </>
          ) : (
            <span className="dropzone-hint">{hint}</span>
          )}
        </span>

        <span className="flex w-full items-end justify-between gap-3">
          <span className="text-[8px] font-semibold tracking-[0.18em] text-[rgba(164,154,184,0.45)]">
            {formats}
          </span>
          <span className="text-[9px] tracking-[0.04em] text-[rgba(220,203,255,0.4)] transition-colors group-hover:text-[rgba(220,203,255,0.75)]">
            {file ? 'CLICK TO REPLACE' : 'BROWSE OR DROP'}
          </span>
        </span>
      </button>
      {error ? (
        <p className="file-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
