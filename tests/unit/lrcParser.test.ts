import { describe, expect, it } from 'vitest';
import { parseLrc, splitWords } from '@/features/lyrics/lrcParser';

describe('parseLrc', () => {
  it('parses timestamps, metadata, and line ordering', () => {
    const result = parseLrc(
      ['[ti:First Light]', '[ar:AFTERGLOW]', '[al:Demo]', '[by:Tester]', '[00:12.50]Later', '[00:01.00]Earlier'].join(
        '\n',
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.metadata.title).toBe('First Light');
    expect(result.lyrics.metadata.artist).toBe('AFTERGLOW');
    expect(result.lyrics.metadata.album).toBe('Demo');
    expect(result.lyrics.metadata.by).toBe('Tester');
    expect(result.lyrics.lines.map((line) => line.text)).toEqual(['Earlier', 'Later']);
    expect(result.lyrics.lines.map((line) => line.startMs)).toEqual([1000, 12500]);
  });

  it('supports two- and three-digit fractions', () => {
    const result = parseLrc('[00:01.5]Two\n[00:02.25]Three\n[00:03.125]Precise');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.lines.map((line) => line.startMs)).toEqual([1500, 2250, 3125]);
  });

  it('expands multiple timestamps on the same line', () => {
    const result = parseLrc('[00:01.00][00:05.00][01:00.00]Chorus');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.lineCount).toBe(3);
    expect(result.lyrics.lines.map((line) => line.startMs)).toEqual([1000, 5000, 60000]);
    expect(new Set(result.lyrics.lines.map((line) => line.id)).size).toBe(3);
  });

  it('joins different lyrics that share a timestamp and drops exact duplicates', () => {
    const result = parseLrc(
      '[00:01.00]Hello\n[00:01.00]World\n[00:01.00]Hello\n[00:05.00]Hello',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.lines[0]?.text).toBe('Hello / World');
    expect(result.lyrics.lines[1]?.text).toBe('Hello');
    expect(result.lyrics.warnings.length).toBeGreaterThan(0);
  });

  it('skips malformed and blank lines while keeping valid ones', () => {
    const result = parseLrc(
      ['[ti:Song]', '', 'not a timestamp', '   ', '[00:02.00]', '[00:03.00]Real'].join('\n'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.lines).toHaveLength(1);
    expect(result.lyrics.lines[0]?.text).toBe('Real');
    expect(result.lyrics.warnings.some((warning) => warning.includes('Line 3'))).toBe(true);
    expect(result.lyrics.warnings.some((warning) => warning.includes('Line 5'))).toBe(true);
  });

  it('applies positive and negative [offset] metadata', () => {
    const delayed = parseLrc('[offset:500]\n[00:01.00]Hello');
    const advanced = parseLrc('[offset:-500]\n[00:01.00]Hello');
    expect(delayed.ok && delayed.lyrics.lines[0]?.startMs).toBe(1500);
    expect(advanced.ok && advanced.lyrics.lines[0]?.startMs).toBe(500);
    expect(delayed.ok && delayed.lyrics.fileOffsetMs).toBe(500);
  });

  it('reads enhanced word timing tags', () => {
    const result = parseLrc('[00:10.00]<00:10.50>Hello <00:11.25>bright <00:12.00>world');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.lyrics.lines[0];
    expect(line?.text).toBe('Hello bright world');
    expect(line?.words).toEqual(['Hello', 'bright', 'world']);
    expect(line?.wordTimings.map((timing) => timing.startMs)).toEqual([10500, 11250, 12000]);
    expect(result.lyrics.hasWordTimings).toBe(true);
  });

  it('normalises BOM, CRLF, and control characters', () => {
    const result = parseLrc('\uFEFF[00:01.00]  Hello\u0000   world\r\n[00:02.00]Again');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lyrics.lines[0]?.text).toBe('Hello world');
  });

  it('rejects empty and untimed files with useful errors', () => {
    const empty = parseLrc('   \n');
    const untimed = parseLrc('[ti:Only metadata]\nno timestamps here');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY');
    expect(untimed.ok).toBe(false);
    if (!untimed.ok) expect(untimed.error.code).toBe('NO_TIMESTAMPS');
  });

  it('splits words without empty tokens', () => {
    expect(splitWords('  one   two\tthree\n')).toEqual(['one', 'two', 'three']);
  });
});
