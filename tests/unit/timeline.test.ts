import { describe, expect, it } from 'vitest';
import { parseLrc } from '@/features/lyrics/lrcParser';
import {
  LyricTimeline,
  buildTimedLines,
  findActiveLineIndex,
  smoothstep,
} from '@/features/lyrics/timeline';

function lyricsFrom(source: string) {
  const result = parseLrc(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.lyrics;
}

const LYRICS = lyricsFrom(
  ['[00:00.00]First line', '[00:05.00]Second line', '[00:10.00]Third line'].join('\n'),
);

describe('LyricTimeline', () => {
  it('follows the audio clock through lines', () => {
    const timeline = new LyricTimeline(LYRICS, { durationMs: 20_000 });
    expect(timeline.getFrame(0).line?.text).toBe('First line');
    expect(timeline.getFrame(4.99).line?.text).toBe('First line');
    expect(timeline.getFrame(5).line?.text).toBe('Second line');
    expect(timeline.getFrame(9.999).lineIndex).toBe(1);
    expect(timeline.getFrame(10).lineIndex).toBe(2);
    expect(timeline.getFrame(10).previousLine?.text).toBe('Second line');
    expect(timeline.getFrame(20).atEnd).toBe(true);
    expect(timeline.getFrame(2).atEnd).toBe(false);
  });

  it('delays and advances lyrics with a positive or negative offset', () => {
    const delayed = new LyricTimeline(LYRICS, { durationMs: 20_000, offsetMs: 2000 });
    expect(delayed.getFrame(1).line).toBeNull();
    expect(delayed.getFrame(7).line?.text).toBe('Second line');
    expect(delayed.getFrame(7).queryTimeMs).toBe(5000);

    const advanced = new LyricTimeline(LYRICS, { durationMs: 20_000, offsetMs: -1000 });
    expect(advanced.getFrame(4).line?.text).toBe('Second line');
    expect(advanced.getFrame(4).queryTimeMs).toBe(5000);
  });

  it('handles seeking backwards and forwards deterministically', () => {
    const timeline = new LyricTimeline(LYRICS, { durationMs: 20_000 });
    const forward = timeline.getFrame(12);
    const backward = timeline.getFrame(0.5);
    const again = timeline.getFrame(12);
    expect(forward.lineIndex).toBe(2);
    expect(backward.lineIndex).toBe(0);
    expect(again.lineIndex).toBe(forward.lineIndex);
    expect(again.lineProgress).toBeCloseTo(forward.lineProgress, 8);
  });

  it('marks words active, completed, and upcoming', () => {
    const wordLyrics = lyricsFrom('[00:00.00]one two three four');
    const timeline = new LyricTimeline(wordLyrics, { durationMs: 8000 });
    const frame = timeline.getFrame(2.2);
    expect(frame.words).toHaveLength(4);
    expect(frame.words.some((word) => word.active)).toBe(true);
    expect(frame.words[0]?.completed || frame.words[0]?.active).toBe(true);
    expect(frame.words[3]?.reveal).toBeGreaterThanOrEqual(0);
    expect(frame.words[3]?.reveal).toBeLessThan(1);
  });

  it('uses enhanced word timings when they match every word', () => {
    const wordLyrics = lyricsFrom(
      '[00:00.00]<00:00.00>Hello <00:02.00>bright <00:04.00>world',
    );
    const timeline = new LyricTimeline(wordLyrics, { durationMs: 8000 });
    const frame = timeline.getFrame(2.1);
    expect(frame.words[0]?.completed).toBe(true);
    expect(frame.words[1]?.active).toBe(true);
    expect(frame.words[2]?.completed).toBe(false);
  });

  it('repeats a merged lyric at its own timestamp', () => {
    const repeated = lyricsFrom('[00:01.00][00:06.00]Echo');
    const timeline = new LyricTimeline(repeated, { durationMs: 12_000 });
    expect(timeline.getFrame(2).line?.text).toBe('Echo');
    expect(timeline.getFrame(7).line?.text).toBe('Echo');
    expect(timeline.getFrame(2).lineIndex).toBe(0);
    expect(timeline.getFrame(7).lineIndex).toBe(1);
  });

  it('extends the final line to the audio duration or fallback tail', () => {
    const timed = buildTimedLines(LYRICS, 31_000);
    expect(timed[2]?.endMs).toBe(31_000);
    const fallback = buildTimedLines(LYRICS, 0, 4000);
    expect(fallback[2]?.endMs).toBe(14_000);
    expect(fallback[0]?.endMs).toBe(5000);
    expect(fallback[0]?.durationMs).toBe(5000);
  });

  it('returns an empty frame before the first lyric', () => {
    const late = lyricsFrom('[00:05.00]Late');
    const timeline = new LyricTimeline(late, { durationMs: 10_000 });
    const frame = timeline.getFrame(1);
    expect(frame.line).toBeNull();
    expect(frame.lineIndex).toBe(-1);
    expect(frame.nextLineStartMs).toBe(5000);
    expect(frame.words).toEqual([]);
  });

  it('binary search and smoothstep behave at boundaries', () => {
    const lines = [{ startMs: 0 }, { startMs: 1000 }, { startMs: 2000 }];
    expect(findActiveLineIndex(lines, -1)).toBe(-1);
    expect(findActiveLineIndex(lines, 0)).toBe(0);
    expect(findActiveLineIndex(lines, 1500)).toBe(1);
    expect(findActiveLineIndex(lines, 9999)).toBe(2);
    expect(findActiveLineIndex([], 100)).toBe(-1);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
  });
});
