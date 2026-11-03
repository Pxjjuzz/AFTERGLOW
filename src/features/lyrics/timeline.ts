import type { WordRevealMode } from '@shared/ipc';
import type { LyricLine, ParsedLyrics } from './lrcParser';

export interface TimedLine extends LyricLine {
  endMs: number;
  durationMs: number;
}

export interface TimedWord {
  index: number;
  text: string;
  /** 0..1 reveal value, smoothstep-eased. */
  reveal: number;
  active: boolean;
  completed: boolean;
}

export interface TimelineFrame {
  /** Audio time with the user offset applied. */
  queryTimeMs: number;
  lineIndex: number;
  previousLineIndex: number;
  line: TimedLine | null;
  previousLine: TimedLine | null;
  lineProgress: number;
  words: TimedWord[];
  nextLineStartMs: number | null;
  atEnd: boolean;
}

export interface TimelineOptions {
  durationMs?: number;
  offsetMs?: number;
  wordReveal?: WordRevealMode;
  /** Used when the audio duration is unknown or shorter than the final lyric. */
  fallbackTailMs?: number;
}

const MIN_WORD_WINDOW = 0.1;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(value: number): number {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

export function findActiveLineIndex(lines: readonly { startMs: number }[], queryTimeMs: number): number {
  if (lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (!line) break;
    if (line.startMs <= queryTimeMs) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function buildTimedLines(
  lyrics: ParsedLyrics,
  durationMs: number,
  fallbackTailMs = 6000,
): TimedLine[] {
  const source = lyrics.lines;
  return source.map((line, index) => {
    const next = source[index + 1];
    const naturalEnd = next ? next.startMs : Math.max(line.startMs + fallbackTailMs, durationMs);
    const endMs = Math.max(line.startMs + 260, naturalEnd);
    return {
      ...line,
      endMs,
      durationMs: endMs - line.startMs,
    };
  });
}

export class LyricTimeline {
  readonly lines: TimedLine[];
  readonly durationMs: number;
  readonly offsetMs: number;
  readonly wordReveal: WordRevealMode;

  constructor(lyrics: ParsedLyrics, options: TimelineOptions = {}) {
    this.offsetMs = options.offsetMs ?? 0;
    this.wordReveal = options.wordReveal ?? 'sequential';
    this.durationMs =
      Number.isFinite(options.durationMs) && (options.durationMs ?? 0) > 0
        ? (options.durationMs as number)
        : 0;
    this.lines = buildTimedLines(lyrics, this.durationMs, options.fallbackTailMs);
  }

  get queryDurationMs(): number {
    const last = this.lines[this.lines.length - 1];
    return Math.max(this.durationMs, last ? last.endMs : 0);
  }

  getFrame(audioTimeSeconds: number): TimelineFrame {
    const audioMs = Number.isFinite(audioTimeSeconds) ? audioTimeSeconds * 1000 : 0;
    const queryTimeMs = audioMs - this.offsetMs;
    const lineIndex = findActiveLineIndex(this.lines, queryTimeMs);
    const line = lineIndex >= 0 ? this.lines[lineIndex] ?? null : null;
    const previousLineIndex = lineIndex - 1;
    const previousLine = previousLineIndex >= 0 ? this.lines[previousLineIndex] ?? null : null;
    const nextLine = lineIndex + 1 < this.lines.length ? this.lines[lineIndex + 1] : null;

    if (!line) {
      return {
        queryTimeMs,
        lineIndex: -1,
        previousLineIndex: -1,
        line: null,
        previousLine: null,
        lineProgress: 0,
        words: [],
        nextLineStartMs: this.lines[0]?.startMs ?? null,
        atEnd: false,
      };
    }

    const lineProgress = clamp((queryTimeMs - line.startMs) / Math.max(1, line.durationMs));
    const words = this.getWordStates(line, lineProgress);

    return {
      queryTimeMs,
      lineIndex,
      previousLineIndex,
      line,
      previousLine,
      lineProgress,
      words,
      nextLineStartMs: nextLine?.startMs ?? null,
      atEnd: this.durationMs > 0 && audioMs >= this.durationMs - 30,
    };
  }

  private getWordStates(line: TimedLine, progress: number): TimedWord[] {
    if (line.words.length === 0) return [];

    if (
      line.wordTimings.length === line.words.length &&
      line.wordTimings.every((timing) => Number.isFinite(timing.startMs))
    ) {
      const activeIndex = this.activeIndexFromStarts(
        line.wordTimings.map((timing) => timing.startMs - line.startMs),
        progress,
        line.durationMs,
      );
      return line.words.map((text, index) => {
        const timing = line.wordTimings[index];
        const nextTiming = line.wordTimings[index + 1];
        const start = (timing?.startMs ?? line.startMs) - line.startMs;
        const nextStart =
          nextTiming !== undefined
            ? nextTiming.startMs - line.startMs
            : Math.max(start + 200, line.durationMs);
        const reveal = smoothstep((progress * line.durationMs - start) / Math.max(80, nextStart - start));
        return {
          index,
          text,
          reveal,
          active: index === activeIndex,
          completed: index < activeIndex,
        };
      });
    }

    const weights = line.words.map((word) =>
      this.wordReveal === 'sequential' ? Math.max(2, word.length) : 1,
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let walked = 0;
    const windows = weights.map((weight) => {
      const start = (walked / totalWeight) * 0.78;
      walked += weight;
      const width = Math.max(MIN_WORD_WINDOW, (weight / totalWeight) * 0.62);
      return { start, end: Math.min(1, start + width) };
    });
    const activeIndex = windows.reduce(
      (last, window, index) => (progress >= window.start ? index : last),
      0,
    );

    return line.words.map((text, index) => {
      const window = windows[index] ?? { start: 0, end: 1 };
      const reveal = smoothstep((progress - window.start) / Math.max(0.02, window.end - window.start));
      return {
        index,
        text,
        reveal,
        active: index === activeIndex,
        completed: index < activeIndex,
      };
    });
  }

  private activeIndexFromStarts(starts: number[], progress: number, durationMs: number): number {
    const timeInLine = progress * durationMs;
    let active = 0;
    for (let index = 0; index < starts.length; index += 1) {
      if ((starts[index] ?? 0) <= timeInLine + 1) active = index;
    }
    return active;
  }
}

export function lineProgress(line: TimedLine, queryTimeMs: number): number {
  return clamp((queryTimeMs - line.startMs) / Math.max(1, line.durationMs));
}
