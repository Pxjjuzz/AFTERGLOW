import type { ConstellationStyle } from '@shared/ipc';

export type { ConstellationStyle };

export interface MeasureText {
  (text: string, fontSize: number): number;
}

export interface LayoutNode {
  id: string;
  index: number;
  text: string;
  /** Star anchor, in CSS pixels. The word sits just below it. */
  x: number;
  y: number;
  fontSize: number;
  rotation: number;
  width: number;
  height: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Small deterministic entry vector, used by the renderer. */
  enterX: number;
  enterY: number;
  starSize: number;
}

export interface LayoutEdge {
  id: string;
  from: number;
  to: number;
  delay: number;
  length: number;
}

export interface Composition {
  lineIndex: number;
  seed: number;
  style: ConstellationStyle;
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  box: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

export interface CompositionRequest {
  words: readonly string[];
  lineIndex: number;
  width: number;
  height: number;
  style: ConstellationStyle;
  measureText?: MeasureText;
  seedOffset?: number;
}

const SAFE_MARGIN_X = 48;
const SAFE_MARGIN_TOP = 92;
const SAFE_MARGIN_BOTTOM = 76;
const SAFE_MARGIN_X_RATIO = 0.055;

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultMeasureText(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function overlaps(
  a: { x: number; y: number; width: number; fontSize: number },
  b: { x: number; y: number; width: number; fontSize: number },
  padding: number,
): boolean {
  const horizontal = Math.abs(a.x - b.x) < (a.width + b.width) / 2 + padding;
  const vertical = Math.abs(a.y - b.y) < (a.fontSize + b.fontSize) * 0.68 + padding;
  return horizontal && vertical;
}

/**
 * The reference frame gives longer words much larger type. This is the core
 * of the silhouette: "somebody" becomes a planet while "me" stays a speck.
 */
function wordScale(word: string): number {
  const length = [...word].length;
  if (length <= 2) return 0.12;
  const normalized = clamp((length - 2) / 6.5);
  return 0.12 + 0.88 * Math.pow(normalized, 1.35);
}

function densityFor(wordCount: number): number {
  if (wordCount > 18) return 0.6;
  if (wordCount > 12) return 0.7;
  if (wordCount > 9) return 0.8;
  if (wordCount > 6) return 0.92;
  return 1;
}

function scatterPoints(
  count: number,
  centerX: number,
  centerY: number,
  boxWidth: number,
  boxHeight: number,
  style: ConstellationStyle,
  random: () => number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const seedAngle = random() * Math.PI * 2;
  const vertical = style === 'kinetic' ? 1.1 : style === 'starfield' ? 1.14 : 1;

  for (let index = 0; index < count; index += 1) {
    if (count === 1) {
      points.push({ x: centerX, y: centerY });
      continue;
    }
    // Golden-angle spiral: deterministic, evenly scattered, no rows.
    const angle = seedAngle + index * 2.399963229728653;
    const radius = 0.11 + 0.42 * Math.sqrt((index + 0.55) / count);
    const x =
      centerX +
      Math.cos(angle) * boxWidth * radius +
      (random() - 0.5) * boxWidth * 0.045;
    const y =
      centerY +
      Math.sin(angle) * boxHeight * radius * vertical +
      (random() - 0.5) * boxHeight * 0.06;
    points.push({ x, y });
  }
  return points;
}

function gridPoints(
  count: number,
  centerX: number,
  centerY: number,
  boxWidth: number,
  boxHeight: number,
  random: () => number,
): { x: number; y: number }[] {
  const rows = count <= 12 ? 2 : 3;
  const columns = Math.ceil(count / rows);
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const offset = row % 2 === 0 ? 0 : 0.38;
    const x =
      centerX +
      ((column + offset) / Math.max(1, columns - 0.2) - 0.5) * boxWidth +
      (random() - 0.5) * boxWidth * 0.035;
    const y =
      centerY +
      (row - (rows - 1) / 2) * (boxHeight / Math.max(1, rows - 0.1)) +
      (random() - 0.5) * boxHeight * 0.05;
    points.push({ x, y });
  }
  return points;
}

function clampPoints(
  points: { x: number; y: number }[],
  widths: number[],
  fontSizes: number[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  const horizontalMargin = Math.max(SAFE_MARGIN_X, width * SAFE_MARGIN_X_RATIO);
  return points.map((point, index) => {
    const textWidth = widths[index] ?? 0;
    const fontSize = fontSizes[index] ?? 20;
    const minX = horizontalMargin + textWidth / 2;
    const maxX = width - horizontalMargin - textWidth / 2;
    const minY = Math.max(SAFE_MARGIN_TOP, fontSize * 1.4);
    const maxY = height - Math.max(SAFE_MARGIN_BOTTOM, fontSize * 1.9);
    return {
      x: minX > maxX ? width / 2 : clamp(point.x, minX, maxX),
      y: clamp(point.y, minY, maxY),
    };
  });
}

interface EdgeCandidate {
  from: number;
  to: number;
  length: number;
}

function connectNodes(
  nodes: LayoutNode[],
  style: ConstellationStyle,
  boxWidth: number,
): LayoutEdge[] {
  const count = nodes.length;
  const candidates = new Map<string, EdgeCandidate>();
  const add = (a: number, b: number): void => {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    if (from === to) return;
    const key = `${from}-${to}`;
    if (candidates.has(key)) return;
    const left = nodes[from];
    const right = nodes[to];
    if (!left || !right) return;
    candidates.set(key, {
      from,
      to,
      length: Math.hypot(left.x - right.x, left.y - right.y),
    });
  };

  // A constellation is a web of nearest neighbours, not a reading line.
  const degree = style === 'constellation' ? 2 : style === 'starfield' ? 1 : 2;
  for (let index = 0; index < count; index += 1) {
    const origin = nodes[index];
    if (!origin) continue;
    const nearest = nodes
      .map((node, other) => ({
        other,
        distance: Math.hypot(origin.x - node.x, origin.y - node.y),
      }))
      .filter((entry) => entry.other !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, degree);
    for (const entry of nearest) add(index, entry.other);
  }

  // Preserve a little of the lyric's reading order in the airier styles.
  if (style === 'kinetic' || count <= 8) {
    for (let index = 0; index < count - 1; index += 1) add(index, index + 1);
  }

  const ordered = [...candidates.values()].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );

  const edges: LayoutEdge[] = ordered.map((edge, index) => ({
    id: `e-${nodes[0]?.id ?? 'x'}-${index}`,
    from: edge.from,
    to: edge.to,
    delay: Math.min(0.62, index * 0.055),
    length: edge.length,
  }));

  if (style === 'constellation' && count >= 4) {
    const first = nodes[0];
    const last = nodes[count - 1];
    if (first && last) {
      const length = Math.hypot(first.x - last.x, first.y - last.y);
      if (length < boxWidth * 0.95) {
        edges.push({
          id: `e-${first.id}-chord`,
          from: 0,
          to: count - 1,
          delay: 0.4,
          length,
        });
      }
    }
  }

  return edges;
}

export function createComposition(request: CompositionRequest): Composition {
  const { words, lineIndex, width, height, style } = request;
  const measureText = request.measureText ?? defaultMeasureText;
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(320, height);
  const textKey = words.join(' ');
  const seed =
    (hashString(`${textKey}|${lineIndex}|${style}`) ^ ((request.seedOffset ?? 0) >>> 0)) >>> 0;
  const random = mulberry32(seed);

  const boxWidth =
    style === 'starfield'
      ? Math.min(safeWidth * 0.74, 1240)
      : style === 'kinetic'
        ? Math.min(safeWidth * 0.7, 1160)
        : Math.min(safeWidth * 0.68, 1180);
  const boxHeight = Math.min(
    safeHeight * (style === 'starfield' ? 0.56 : 0.48),
    style === 'starfield' ? 620 : 540,
  );
  const centerX = safeWidth / 2;
  const centerY = safeHeight * 0.47;

  const styleScale = style === 'kinetic' ? 1.06 : style === 'starfield' ? 0.96 : 1;
  const density = densityFor(words.length) * styleScale;
  const maxFont = Math.max(
    32,
    clamp(Math.min(safeWidth, safeHeight) * 0.118, 42, 152) * density,
  );
  const minFont = Math.max(12, maxFont * 0.18);

  const fontSizes = words.map((word) => {
    const size = minFont + (maxFont - minFont) * wordScale(word);
    return Math.round(size * 10) / 10;
  });
  const widths = words.map(
    (word, index) => measureText(word, fontSizes[index] ?? minFont) + 8,
  );

  // A single enormous word must still fit the safe area.
  const frameMarginX = Math.max(SAFE_MARGIN_X, safeWidth * SAFE_MARGIN_X_RATIO);
  const availableWordWidth = safeWidth - frameMarginX * 2;
  const widest = widths.reduce((max, value) => Math.max(max, value), 0);
  if (widest > availableWordWidth * 0.9) {
    const scale = (availableWordWidth * 0.9) / widest;
    for (let index = 0; index < fontSizes.length; index += 1) {
      fontSizes[index] = Math.max(11, (fontSizes[index] ?? minFont) * scale);
      widths[index] = measureText(words[index] ?? '', fontSizes[index] ?? minFont) + 8;
    }
  }

  let points =
    words.length <= 9
      ? scatterPoints(words.length, centerX, centerY, boxWidth, boxHeight, style, random)
      : gridPoints(words.length, centerX, centerY, boxWidth, boxHeight, random);

  points = clampPoints(points, widths, fontSizes, safeWidth, safeHeight);

  // Deterministic separation pass. With mixed type sizes the largest word
  // needs far more room, so the nudge distance scales with the composition.
  const padding = Math.max(16, Math.min(42, maxFont * 0.34));
  for (let pass = 0; pass < 180; pass += 1) {
    let moved = false;
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const pointA = points[a];
        const pointB = points[b];
        if (!pointA || !pointB) continue;
        const nodeA = {
          x: pointA.x,
          y: pointA.y,
          width: widths[a] ?? 0,
          fontSize: fontSizes[a] ?? minFont,
        };
        const nodeB = {
          x: pointB.x,
          y: pointB.y,
          width: widths[b] ?? 0,
          fontSize: fontSizes[b] ?? minFont,
        };
        if (!overlaps(nodeA, nodeB, padding)) continue;
        moved = true;
        const horizontal =
          nodeA.width / 2 + nodeB.width / 2 + padding - Math.abs(nodeA.x - nodeB.x);
        const vertical =
          (nodeA.fontSize + nodeB.fontSize) * 0.68 + padding - Math.abs(nodeA.y - nodeB.y);
        if (horizontal < vertical * 1.15) {
          const direction = nodeA.x <= nodeB.x ? -1 : 1;
          pointA.x += direction * Math.min(36, horizontal / 2 + 1.5);
          pointB.x -= direction * Math.min(36, horizontal / 2 + 1.5);
        } else {
          const direction = nodeA.y <= nodeB.y ? -1 : 1;
          pointA.y += direction * Math.min(32, vertical / 2 + 1.5);
          pointB.y -= direction * Math.min(32, vertical / 2 + 1.5);
        }
      }
    }
    points = clampPoints(points, widths, fontSizes, safeWidth, safeHeight);
    if (!moved) break;
  }

  const angleSeed = random() * Math.PI * 2;
  const nodes: LayoutNode[] = words.map((text, index) => {
    const point = points[index] ?? { x: centerX, y: centerY };
    const fontSize = fontSizes[index] ?? minFont;
    const width = widths[index] ?? measureText(text, fontSize);
    const rotation =
      style === 'kinetic' ? (random() - 0.5) * 4.6 : (random() - 0.5) * 1.1;
    const angle = angleSeed + index * 1.7;
    const drift = style === 'kinetic' ? 22 : style === 'starfield' ? 14 : 10;
    const baseline = point.y + fontSize * 0.95;
    return {
      id: `n-${lineIndex}-${index}`,
      index,
      text,
      x: point.x,
      y: point.y,
      fontSize,
      rotation,
      width,
      height: fontSize * 0.8,
      bounds: {
        left: point.x - width / 2,
        top: baseline - fontSize * 0.82,
        right: point.x + width / 2,
        bottom: baseline + fontSize * 0.1,
      },
      enterX: Math.cos(angle) * drift,
      enterY: Math.sin(angle) * drift,
      starSize: 1.1 + Math.min(1.5, text.length * 0.08),
    };
  });

  const edges = connectNodes(nodes, style, boxWidth);

  return {
    lineIndex,
    seed,
    style,
    width: safeWidth,
    height: safeHeight,
    nodes,
    edges,
    box: {
      left: centerX - boxWidth / 2,
      top: centerY - boxHeight / 2,
      right: centerX + boxWidth / 2,
      bottom: centerY + boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    },
  };
}
