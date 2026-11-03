/** Standard LRC plus optional enhanced word timestamps (`<mm:ss.xx>`). */

export interface LrcMetadata {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  length?: string;
  offsetMs: number;
  raw: Record<string, string>;
}

export interface WordTiming {
  text: string;
  startMs: number;
}

export interface LyricLine {
  /** Stable source ordering key. */
  id: string;
  index: number;
  startMs: number;
  text: string;
  words: string[];
  /** Absolute word timestamps when enhanced LRC supplied them. */
  wordTimings: WordTiming[];
  sourceLines: number[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  metadata: LrcMetadata;
  /** Parsed `[offset:]`; positive values delay the line. */
  fileOffsetMs: number;
  hasWordTimings: boolean;
  warnings: string[];
  lineCount: number;
}

export type LrcErrorCode = 'EMPTY' | 'NO_TIMESTAMPS' | 'TOO_LARGE_TEXT';

export interface LrcError {
  code: LrcErrorCode;
  message: string;
}

export type LrcParseResult =
  | { ok: true; lyrics: ParsedLyrics }
  | { ok: false; error: LrcError };

const TIMESTAMP = /\[(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?\]/g;
const WORD_TIMESTAMP = /<(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?>/g;
const METADATA = /^\[([a-zA-Z][a-zA-Z0-9_-]*):(.*)\]$/;

function fractionToMs(fraction: string | undefined): number {
  if (!fraction) return 0;
  const digits = fraction.padEnd(3, '0').slice(0, 3);
  return Number(digits);
}

function parseMinutesSeconds(minutes: string, seconds: string, fraction?: string): number {
  const mins = Number(minutes);
  const secs = Number(seconds);
  return (mins * 60 + secs) * 1000 + fractionToMs(fraction);
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

interface WordSegment {
  text: string;
  startMs: number;
}

interface RawEntry {
  startMs: number;
  text: string;
  words: string[];
  wordTimings: WordTiming[];
  sourceLine: number;
  sourceLines: number[];
  order: number;
}

function extractWordSegments(textWithTags: string): { displayText: string; segments: WordSegment[] } {
  const segments: WordSegment[] = [];
  const tags: { index: number; end: number; startMs: number }[] = [];
  let match: RegExpExecArray | null;
  WORD_TIMESTAMP.lastIndex = 0;
  while ((match = WORD_TIMESTAMP.exec(textWithTags)) !== null) {
    tags.push({
      index: match.index,
      end: match.index + match[0].length,
      startMs: parseMinutesSeconds(match[1] ?? '0', match[2] ?? '0', match[3]),
    });
  }

  if (tags.length === 0) {
    return { displayText: normalizeText(textWithTags), segments: [] };
  }

  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i];
    if (!tag) continue;
    const next = tags[i + 1];
    const raw = textWithTags.slice(tag.end, next ? next.index : textWithTags.length);
    const text = normalizeText(raw);
    if (text) {
      segments.push({ text, startMs: tag.startMs });
    }
  }

  const displayText = normalizeText(textWithTags.replace(WORD_TIMESTAMP, ' '));
  return { displayText, segments };
}

function buildWordTimings(words: string[], segments: WordSegment[]): WordTiming[] {
  if (words.length === 0 || segments.length === 0) return [];

  const timings: WordTiming[] = [];
  let searchFrom = 0;
  for (const segment of segments) {
    const segmentWords = splitWords(segment.text);
    const needle = segmentWords[0];
    if (!needle) continue;
    const found = words.indexOf(needle, searchFrom);
    if (found === -1) continue;
    const count = Math.max(1, segmentWords.length);
    for (let offset = 0; offset < count; offset += 1) {
      const wordIndex = found + offset;
      if (wordIndex >= words.length) break;
      timings.push({
        text: words[wordIndex] ?? '',
        startMs: segment.startMs + Math.round((offset / count) * 220),
      });
    }
    searchFrom = found + count;
  }
  return timings;
}

export function parseLrc(source: string): LrcParseResult {
  const warnings: string[] = [];
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, error: { code: 'EMPTY', message: 'The lyrics file is empty.' } };
  }
  if (source.length > 2_000_000) {
    return {
      ok: false,
      error: { code: 'TOO_LARGE_TEXT', message: 'The lyrics file is too large to parse.' },
    };
  }

  const rawMetadata: Record<string, string> = {};
  let fileOffsetMs = 0;
  const entries: RawEntry[] = [];
  let order = 0;
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sourceLines = normalized.split('\n');

  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const originalLine = sourceLines[lineIndex] ?? '';
    const line = originalLine.trim();
    if (!line) continue;

    // Metadata only applies when the whole line is a single bracket tag.
    const metadataMatch = METADATA.exec(line);
    if (metadataMatch && !TIMESTAMP.test(line)) {
      TIMESTAMP.lastIndex = 0;
      const key = (metadataMatch[1] ?? '').toLowerCase();
      const rawValue = normalizeText(metadataMatch[2] ?? '');
      rawMetadata[key] = rawValue;
      if (key === 'offset') {
        const value = Number.parseInt(rawValue.replace(/^\+/, ''), 10);
        if (Number.isFinite(value)) {
          fileOffsetMs = Math.max(-10_000, Math.min(10_000, value));
        } else {
          warnings.push(`Line ${lineIndex + 1}: could not read the [offset] tag.`);
        }
      }
      continue;
    }
    TIMESTAMP.lastIndex = 0;

    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP.exec(line)) !== null) {
      timestamps.push(parseMinutesSeconds(match[1] ?? '0', match[2] ?? '0', match[3]));
    }
    TIMESTAMP.lastIndex = 0;

    if (timestamps.length === 0) {
      warnings.push(`Line ${lineIndex + 1}: skipped because it has no valid timestamp.`);
      continue;
    }

    const withoutLineTags = line.replace(TIMESTAMP, ' ');
    TIMESTAMP.lastIndex = 0;
    const { displayText, segments } = extractWordSegments(withoutLineTags);
    if (!displayText) {
      warnings.push(`Line ${lineIndex + 1}: skipped because its lyric text is empty.`);
      continue;
    }

    const words = splitWords(displayText);
    if (words.length === 0) continue;
    const wordTimings = timestamps.length === 1 ? buildWordTimings(words, segments) : [];

    for (const startMs of timestamps) {
      entries.push({
        startMs,
        text: displayText,
        words,
        wordTimings,
        sourceLine: lineIndex + 1,
        sourceLines: [lineIndex + 1],
        order: order++,
      });
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      error: {
        code: 'NO_TIMESTAMPS',
        message: 'No timestamped lyric lines were found. Use standard [mm:ss.xx] timestamps.',
      },
    };
  }

  entries.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    if (a.sourceLine !== b.sourceLine) return a.sourceLine - b.sourceLine;
    return a.order - b.order;
  });

  const merged: RawEntry[] = [];
  const textsByTimestamp = new Map<number, Set<string>>();
  for (const entry of entries) {
    const texts = textsByTimestamp.get(entry.startMs) ?? new Set<string>();
    if (texts.has(entry.text)) {
      warnings.push(`Line ${entry.sourceLine}: duplicate timestamp and text were ignored.`);
      continue;
    }
    texts.add(entry.text);
    textsByTimestamp.set(entry.startMs, texts);

    const previous = merged[merged.length - 1];
    if (previous && previous.startMs === entry.startMs) {
      const combinedText = `${previous.text} / ${entry.text}`;
      previous.text = combinedText;
      previous.words = splitWords(combinedText);
      previous.wordTimings = [];
      previous.sourceLines = [...previous.sourceLines, entry.sourceLine];
      warnings.push(
        `Line ${entry.sourceLine}: shared a timestamp; both lyric lines were joined.`,
      );
      continue;
    }
    merged.push(entry);
  }

  const lines: LyricLine[] = merged.map((entry, index) => ({
    id: `line-${index}-${entry.startMs}`,
    index,
    startMs: entry.startMs + fileOffsetMs,
    text: entry.text,
    words: entry.words,
    wordTimings: entry.wordTimings.map((timing) => ({
      ...timing,
      startMs: timing.startMs + fileOffsetMs,
    })),
    sourceLines: entry.sourceLines,
  }));

  const metadata: LrcMetadata = {
    offsetMs: fileOffsetMs,
    raw: rawMetadata,
  };
  const title = rawMetadata.ti ?? rawMetadata.title;
  const artist = rawMetadata.ar ?? rawMetadata.artist;
  const album = rawMetadata.al ?? rawMetadata.album;
  const by = rawMetadata.by ?? rawMetadata.author;
  if (title) metadata.title = title;
  if (artist) metadata.artist = artist;
  if (album) metadata.album = album;
  if (by) metadata.by = by;
  if (rawMetadata.length) metadata.length = rawMetadata.length;

  return {
    ok: true,
    lyrics: {
      lines,
      metadata,
      fileOffsetMs,
      hasWordTimings: lines.some((line) => line.wordTimings.length > 0),
      warnings,
      lineCount: lines.length,
    },
  };
}
