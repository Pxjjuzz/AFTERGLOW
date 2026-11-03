import { describe, expect, it } from 'vitest';
import {
  createComposition,
  defaultMeasureText,
  hashString,
  mulberry32,
  type Composition,
} from '@/features/constellation/layout';

const words = ['Every', 'song', 'creates', 'its', 'own', 'universe'];

function overlaps(a: Composition['nodes'][number], b: Composition['nodes'][number]): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 2 &&
    Math.abs(a.y - b.y) < (a.fontSize + b.fontSize) * 0.62
  );
}

describe('createComposition', () => {
  it('is deterministic for the same line, style, and size', () => {
    const first = createComposition({ words, lineIndex: 3, width: 1440, height: 900, style: 'constellation' });
    const second = createComposition({ words, lineIndex: 3, width: 1440, height: 900, style: 'constellation' });
    expect(second).toEqual(first);
  });

  it('scales type with word length for the constellation treatment', () => {
    const composition = createComposition({
      words: ['me', 'somebody'],
      lineIndex: 0,
      width: 1440,
      height: 900,
      style: 'constellation',
    });
    const short = composition.nodes[0];
    const long = composition.nodes[1];
    expect(short).toBeDefined();
    expect(long).toBeDefined();
    expect(long!.fontSize).toBeGreaterThan(short!.fontSize * 2.4);
  });

  it('changes when the lyric line or arrangement changes', () => {
    const base = createComposition({ words, lineIndex: 1, width: 1280, height: 800, style: 'constellation' });
    const otherLine = createComposition({ words, lineIndex: 2, width: 1280, height: 800, style: 'constellation' });
    const kinetic = createComposition({ words, lineIndex: 1, width: 1280, height: 800, style: 'kinetic' });
    const starfield = createComposition({ words, lineIndex: 1, width: 1280, height: 800, style: 'starfield' });
    expect(otherLine.seed).not.toBe(base.seed);
    expect(kinetic.seed).not.toBe(base.seed);
    expect(starfield.seed).not.toBe(base.seed);
    expect(kinetic.nodes.map((node) => node.fontSize)).not.toEqual(base.nodes.map((node) => node.fontSize));
  });

  it('keeps every word inside the canvas for the three styles', () => {
    for (const style of ['constellation', 'starfield', 'kinetic'] as const) {
      const composition = createComposition({ words, lineIndex: 0, width: 1440, height: 900, style });
      expect(composition.nodes).toHaveLength(words.length);
      for (const node of composition.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(32 + node.width / 2 - 0.001);
        expect(node.x).toBeLessThanOrEqual(1440 - 32 - node.width / 2 + 0.001);
        expect(node.y).toBeGreaterThanOrEqual(84 - 0.001);
        expect(node.y).toBeLessThanOrEqual(900 - 64 + 0.001);
        expect(node.text.length).toBeGreaterThan(0);
        expect(node.fontSize).toBeGreaterThan(0);
      }
    }
  });

  it('separates word anchors enough to stay legible', () => {
    const composition = createComposition({ words, lineIndex: 2, width: 1440, height: 900, style: 'constellation' });
    let overlappingPairs = 0;
    for (let a = 0; a < composition.nodes.length; a += 1) {
      for (let b = a + 1; b < composition.nodes.length; b += 1) {
        const left = composition.nodes[a];
        const right = composition.nodes[b];
        if (left && right && overlaps(left, right)) overlappingPairs += 1;
      }
    }
    expect(overlappingPairs).toBe(0);
  });

  it('stays stable and bounded after resizing', () => {
    const wide = createComposition({ words, lineIndex: 4, width: 1920, height: 1080, style: 'starfield' });
    const narrow = createComposition({ words, lineIndex: 4, width: 900, height: 620, style: 'starfield' });
    expect(wide.width).toBe(1920);
    expect(wide.height).toBe(1080);
    expect(narrow.width).toBe(900);
    expect(narrow.height).toBe(620);
    for (const node of narrow.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(narrow.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(narrow.height);
    }
  });

  it('handles long lyric lines with many words', () => {
    const many = Array.from({ length: 22 }, (_, index) => `word${index + 1}`);
    const composition = createComposition({ words: many, lineIndex: 7, width: 1180, height: 720, style: 'kinetic' });
    expect(composition.nodes).toHaveLength(22);
    for (const node of composition.nodes) {
      expect(node.fontSize).toBeGreaterThanOrEqual(11);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1180);
    }
    expect(composition.edges.length).toBeGreaterThan(10);
  });

  it('clamps tiny viewports to a safe minimum composition size', () => {
    const composition = createComposition({ words: ['tiny', 'stage'], lineIndex: 0, width: 10, height: 20, style: 'constellation' });
    expect(composition.width).toBe(320);
    expect(composition.height).toBe(320);
  });

  it('creates progressive edges and a closing chord for constellations', () => {
    const composition = createComposition({ words: ['a', 'b', 'c', 'd'], lineIndex: 0, width: 1200, height: 800, style: 'constellation' });
    expect(composition.edges.length).toBeGreaterThanOrEqual(3);
    expect(composition.edges.map((edge) => edge.delay)).toEqual(
      [...composition.edges.map((edge) => edge.delay)].sort((a, b) => a - b),
    );
    expect(composition.edges.every((edge) => edge.length >= 0)).toBe(true);
    for (const edge of composition.edges) {
      expect(composition.nodes[edge.from]).toBeDefined();
      expect(composition.nodes[edge.to]).toBeDefined();
      expect(edge.to).toBeGreaterThan(edge.from);
    }
  });

  it('uses a custom text measurer for width-aware layout', () => {
    const measured = createComposition({
      words: ['measured', 'words'],
      lineIndex: 0,
      width: 1200,
      height: 800,
      style: 'constellation',
      measureText: (text, size) => text.length * size,
    });
    expect(measured.nodes[0]?.width).toBeGreaterThan(defaultMeasureText('measured', measured.nodes[0]?.fontSize ?? 1) + 6);
  });

  it('provides stable seed helpers', () => {
    expect(hashString('afterglow')).toBe(hashString('afterglow'));
    expect(hashString('afterglow')).not.toBe(hashString('afterglow!'));
    const first = mulberry32(42);
    const second = mulberry32(42);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });
});
