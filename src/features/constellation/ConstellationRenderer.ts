import { gsap } from 'gsap';
import type { ConstellationStyle } from '@shared/ipc';
import { SILENT_SPECTRUM, type SpectrumLevels } from '@/lib/spectrum';
import type { LyricTimeline, TimedLine, TimelineFrame, TimedWord } from '@/features/lyrics/timeline';
import { createComposition, mulberry32, type Composition, type LayoutNode } from './layout';
import { getCanvasMetrics } from './canvasMetrics';

export interface PlaybackSample {
  time: number;
  playing: boolean;
  ended: boolean;
}

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  timeline: LyricTimeline;
  style: ConstellationStyle;
  intensity: number;
  reducedMotion: boolean;
  sample: () => PlaybackSample;
  levels?: () => SpectrumLevels;
  onLineChange?: (lineIndex: number, line: TimedLine | null) => void;
}

interface AmbientStar {
  nx: number;
  ny: number;
  size: number;
  alpha: number;
  phase: number;
  speed: number;
  depth: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

interface TransitionState {
  starsAlpha: number;
  currentAlpha: number;
  oldAlpha: number;
  edgeProgress: number;
  newDrift: number;
  oldDrift: number;
}

interface EdgeBar {
  edge: 'top' | 'bottom';
  /** Centre along the edge, 0..1. */
  center: number;
  /** Half length as a fraction of the screen width. */
  half: number;
  /** Horizontal drift amplitude, in CSS pixels. */
  drift: number;
  driftSpeed: number;
  breatheSpeed: number;
  hotSpeed: number;
  phase: number;
  weight: number;
  /** Which band drives this segment hardest. */
  band: 'bass' | 'mid' | 'treble' | 'level';
}

interface WordHandoff {
  from: { x: number; y: number };
  control: { x: number; y: number };
  to: { x: number; y: number };
  startedAt: number;
  duration: number;
}

const STAGE_TINT = '139, 92, 255';
const EDGE_CORE = '205, 184, 255';
const UPCOMING_RGB = [126, 117, 150] as const;
const SETTLED_RGB = [178, 168, 198] as const;
const INK_RGB = [255, 255, 255] as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number): number {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
}

function easeInOutCubic(value: number): number {
  const x = clamp(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * clamp(t));
}

function energyColor(energy: number): string {
  const e = clamp(energy);
  if (e < 0.54) {
    const t = e / 0.54;
    return `rgb(${mixChannel(UPCOMING_RGB[0], SETTLED_RGB[0], t)}, ${mixChannel(
      UPCOMING_RGB[1],
      SETTLED_RGB[1],
      t,
    )}, ${mixChannel(UPCOMING_RGB[2], SETTLED_RGB[2], t)})`;
  }
  const t = (e - 0.54) / 0.46;
  return `rgb(${mixChannel(SETTLED_RGB[0], INK_RGB[0], t)}, ${mixChannel(
    SETTLED_RGB[1],
    INK_RGB[1],
    t,
  )}, ${mixChannel(SETTLED_RGB[2], INK_RGB[2], t)})`;
}

function quadraticPoint(
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

function makeGlowSprite(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.12, 'rgba(236,226,255,0.6)');
  gradient.addColorStop(0.38, `rgba(${STAGE_TINT},0.22)`);
  gradient.addColorStop(0.7, `rgba(${STAGE_TINT},0.04)`);
  gradient.addColorStop(1, `rgba(${STAGE_TINT},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return canvas;
}

function makeSparkSprite(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.translate(32, 32);

  const halo = context.createRadialGradient(0, 0, 0, 0, 0, 31);
  halo.addColorStop(0, 'rgba(255,255,255,0.9)');
  halo.addColorStop(0.22, 'rgba(214,194,255,0.5)');
  halo.addColorStop(1, 'rgba(139,92,255,0)');
  context.fillStyle = halo;
  context.fillRect(-32, -32, 64, 64);

  context.beginPath();
  context.moveTo(0, -29);
  context.quadraticCurveTo(2.8, -3.2, 29, 0);
  context.quadraticCurveTo(2.8, 3.2, 0, 29);
  context.quadraticCurveTo(-2.8, 3.2, -29, 0);
  context.quadraticCurveTo(-2.8, -3.2, 0, -29);
  context.closePath();
  context.fillStyle = 'rgba(255,255,255,0.96)';
  context.fill();
  return canvas;
}

function wordFont(fontSize: number, weight = 700): string {
  return `${weight} ${fontSize}px "Inter", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
}

function setWordTracking(context: CanvasRenderingContext2D, fontSize: number): void {
  const target = context as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in target) {
    target.letterSpacing = `${(-fontSize * 0.02).toFixed(2)}px`;
  }
}

export class ConstellationRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly config: RendererConfig;
  private readonly glowSprite: HTMLCanvasElement;
  private readonly sparkSprite: HTMLCanvasElement;
  private readonly transition: TransitionState = {
    starsAlpha: 0,
    currentAlpha: 0,
    oldAlpha: 0,
    edgeProgress: 0,
    newDrift: 0,
    oldDrift: 0,
  };

  private width = 1;
  private height = 1;
  private dpr = 1;
  private stars: AmbientStar[] = [];
  private motes: Mote[] = [];
  private edgeBars: EdgeBar[] = [];
  private spectrum: SpectrumLevels = { ...SILENT_SPECTRUM };
  private currentComposition: Composition | null = null;
  private previousComposition: Composition | null = null;
  private currentFrame: TimelineFrame | null = null;
  private previousFrame: TimelineFrame | null = null;
  private lineIndex = -1;
  private lastNotifiedLine = -2;
  private lastSampleTime: number | null = null;
  private lastSeek = false;
  private lastDrawAt = 0;
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private disposed = false;
  private introStarted = false;
  private wordEnergy: number[] = [];
  private energyComposition: Composition | null = null;
  private lastActiveWord = -1;
  private handoffs: WordHandoff[] = [];
  private animationDelta = 0.016;
  private resizeObserver: ResizeObserver | null = null;
  private pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private quality = 0;
  private minFrameInterval = 0;
  private lastQualityCheck = 0;
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.config.reducedMotion) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    this.pointer.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  private readonly onResize = (): void => {
    this.resizeCanvas();
  };

  constructor(config: RendererConfig) {
    this.config = config;
    this.canvas = config.canvas;
    const context = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) throw new Error('Canvas 2D is not available.');
    this.context = context;
    this.glowSprite = makeGlowSprite();
    this.sparkSprite = makeSparkSprite();
    this.resizeCanvas();
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.canvas);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => {
        if (this.disposed) return;
        this.rebuildCurrentComposition();
        this.drawOnce();
      });
    }
  }

  private resizeCanvas(): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || window.innerWidth || 1);
    const cssHeight = Math.max(1, rect.height || window.innerHeight || 1);
    const maxDpr = this.quality >= 2 ? 1 : this.quality >= 1 ? 1.5 : 2;
    const metrics = getCanvasMetrics(
      cssWidth,
      cssHeight,
      window.devicePixelRatio || 1,
      maxDpr,
    );
    if (
      this.width === metrics.cssWidth &&
      this.height === metrics.cssHeight &&
      this.dpr === metrics.dpr &&
      this.canvas.width === metrics.pixelWidth &&
      this.canvas.height === metrics.pixelHeight
    ) {
      return;
    }
    this.width = metrics.cssWidth;
    this.height = metrics.cssHeight;
    this.dpr = metrics.dpr;
    this.canvas.width = metrics.pixelWidth;
    this.canvas.height = metrics.pixelHeight;
    this.context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
    this.buildAmbientField();
    this.buildEdgeBars();
    this.rebuildCurrentComposition();
    if (!this.running) this.drawOnce();
  }

  private buildAmbientField(): void {
    const random = mulberry32(0xaf7e12);
    const baseCount =
      this.config.style === 'starfield' ? 120 : this.config.style === 'constellation' ? 72 : 60;
    const count = this.quality >= 2 ? 28 : this.quality >= 1 ? Math.floor(baseCount * 0.6) : baseCount;
    this.stars = Array.from({ length: count }, () => ({
      nx: random(),
      ny: random(),
      size: 0.35 + random() * random() * 1.25,
      alpha: 0.04 + random() * 0.26,
      phase: random() * Math.PI * 2,
      speed: 0.15 + random() * 0.5,
      depth: 0.2 + random() * 0.8,
    }));

    const moteCount = this.config.reducedMotion || this.quality >= 1 ? 0 : 9;
    this.motes = Array.from({ length: moteCount }, () => ({
      x: random() * this.width,
      y: random() * this.height,
      vx: (random() - 0.5) * 4,
      vy: -1 - random() * 3,
      radius: 0.5 + random() * 0.9,
      alpha: 0.04 + random() * 0.1,
    }));
  }

  /**
   * Independent light segments along the top and bottom bezel only. They never
   * meet at the corners, so the frame stays open like the reference: a band of
   * glow, a gap, another band. Each segment gets its own drift and pulse so the
   * edges breathe instead of reading as a CSS border.
   */
  private buildEdgeBars(): void {
    const random = mulberry32(0x5c1e9a);
    const phase = (): number => random() * Math.PI * 2;
    this.edgeBars = [
      {
        edge: 'top',
        center: 0.2,
        half: 0.13,
        drift: 26,
        driftSpeed: 0.7,
        breatheSpeed: 0.9,
        hotSpeed: 1.1,
        phase: phase(),
        weight: 0.95,
        band: 'treble',
      },
      {
        edge: 'top',
        center: 0.5,
        half: 0.13,
        drift: 18,
        driftSpeed: 1.1,
        breatheSpeed: 1.25,
        hotSpeed: 0.8,
        phase: phase(),
        weight: 1,
        band: 'mid',
      },
      {
        edge: 'top',
        center: 0.8,
        half: 0.13,
        drift: 30,
        driftSpeed: 0.85,
        breatheSpeed: 1.05,
        hotSpeed: 1.35,
        phase: phase(),
        weight: 0.92,
        band: 'treble',
      },
      {
        edge: 'bottom',
        center: 0.16,
        half: 0.12,
        drift: 22,
        driftSpeed: 0.95,
        breatheSpeed: 1.15,
        hotSpeed: 1.2,
        phase: phase(),
        weight: 0.9,
        band: 'bass',
      },
      {
        edge: 'bottom',
        center: 0.47,
        half: 0.16,
        drift: 32,
        driftSpeed: 0.75,
        breatheSpeed: 0.85,
        hotSpeed: 0.95,
        phase: phase(),
        weight: 1,
        band: 'level',
      },
      {
        edge: 'bottom',
        center: 0.8,
        half: 0.13,
        drift: 24,
        driftSpeed: 1.05,
        breatheSpeed: 1.2,
        hotSpeed: 1.15,
        phase: phase(),
        weight: 0.94,
        band: 'mid',
      },
    ];
  }

  private buildComposition(line: TimedLine): Composition {
    return createComposition({
      words: line.words,
      lineIndex: line.index,
      width: this.width,
      height: this.height,
      style: this.config.style,
      measureText: (text, fontSize) => {
        this.context.font = wordFont(fontSize, 700);
        setWordTracking(this.context, fontSize);
        return this.context.measureText(text).width;
      },
    });
  }

  private rebuildCurrentComposition(): void {
    const line = this.currentFrame?.line;
    if (!line) {
      this.currentComposition = null;
      this.previousComposition = null;
      return;
    }
    this.currentComposition = this.buildComposition(line);
    const previousLine = this.previousFrame?.line;
    this.previousComposition = previousLine ? this.buildComposition(previousLine) : null;
  }

  private startIntro(): void {
    if (this.introStarted) return;
    this.introStarted = true;
    if (this.config.reducedMotion) {
      this.transition.starsAlpha = 1;
      return;
    }
    gsap.fromTo(
      this.transition,
      { starsAlpha: 0 },
      { starsAlpha: 1, duration: 2.2, ease: 'power2.out' },
    );
  }

  private beginLine(frame: TimelineFrame, seek: boolean): void {
    this.previousComposition = this.currentComposition;
    this.previousFrame = this.currentFrame;
    this.currentFrame = frame;
    this.lineIndex = frame.lineIndex;
    this.currentComposition = frame.line ? this.buildComposition(frame.line) : null;
    this.energyComposition = null;
    this.lastActiveWord = -1;
    this.handoffs = [];

    const reduced = this.config.reducedMotion || seek;
    const duration = reduced ? 0.18 : 0.82;
    gsap.killTweensOf(this.transition);

    if (!frame.line) {
      this.transition.currentAlpha = 0;
      this.transition.oldAlpha = reduced ? 0 : this.previousComposition ? 1 : 0;
      if (!reduced) {
        gsap.to(this.transition, {
          oldAlpha: 0,
          duration,
          ease: 'power2.out',
        });
      }
      this.notifyLine(frame);
      return;
    }

    if (reduced) {
      this.transition.currentAlpha = 1;
      this.transition.oldAlpha = 0;
      this.transition.edgeProgress = 1;
      this.transition.newDrift = 0;
      this.transition.oldDrift = 0;
      this.notifyLine(frame);
      return;
    }

    this.transition.currentAlpha = 0;
    this.transition.edgeProgress = 0;
    this.transition.newDrift = this.config.style === 'kinetic' ? 14 : 8;
    this.transition.oldAlpha = this.previousComposition ? 1 : 0;
    this.transition.oldDrift = 0;

    gsap.to(this.transition, {
      currentAlpha: 1,
      newDrift: 0,
      duration,
      ease: 'power2.out',
    });
    gsap.to(this.transition, {
      edgeProgress: 1,
      duration: reduced ? 0.18 : 1.12,
      ease: 'power2.out',
    });
    if (this.previousComposition) {
      gsap.to(this.transition, {
        oldAlpha: 0,
        oldDrift: this.config.style === 'kinetic' ? 22 : 14,
        duration: reduced ? 0.18 : 0.58,
        ease: 'power2.in',
      });
    }
    this.notifyLine(frame);
  }

  private notifyLine(frame: TimelineFrame): void {
    if (frame.lineIndex === this.lastNotifiedLine) return;
    this.lastNotifiedLine = frame.lineIndex;
    this.config.onLineChange?.(frame.lineIndex, frame.line ?? null);
  }

  private sampleNow(): { sample: PlaybackSample; frame: TimelineFrame } {
    const sample = this.config.sample();
    const safeTime = Number.isFinite(sample.time) ? Math.max(0, sample.time) : 0;
    const frame = this.config.timeline.getFrame(safeTime);
    const delta =
      this.lastSampleTime === null ? 0 : Math.abs(safeTime - this.lastSampleTime);
    const jump = Math.abs(frame.lineIndex - this.lineIndex) > 1;
    const seek = delta > 1.15 || jump;

    if (frame.lineIndex !== this.lineIndex) {
      this.beginLine(frame, seek);
    } else {
      this.currentFrame = frame;
      if (!this.currentComposition && frame.line) {
        this.currentComposition = this.buildComposition(frame.line);
        this.transition.currentAlpha = 1;
        this.transition.edgeProgress = 1;
      }
    }

    this.lastSampleTime = safeTime;
    this.lastSeek = seek;
    return { sample: { ...sample, time: safeTime }, frame };
  }

  start(): void {
    if (this.disposed) return;
    this.startIntro();
    if (this.running) return;
    this.running = true;
    this.lastDrawAt = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setPlaying(playing: boolean): void {
    if (this.disposed) return;
    if (playing) {
      this.paused = false;
      this.lastDrawAt = 0;
      this.start();
      return;
    }
    // Freeze the lyric frame, but keep the ambient edge light breathing at a
    // low cadence. A paused universe should still feel alive.
    gsap.killTweensOf(this.transition);
    this.transition.currentAlpha = this.currentComposition ? 1 : 0;
    this.transition.oldAlpha = 0;
    this.transition.edgeProgress = 1;
    this.transition.newDrift = 0;
    this.transition.oldDrift = 0;
    this.sampleNow();
    this.drawAt(performance.now(), true);
    if (this.config.reducedMotion) {
      this.paused = false;
      this.stop();
      return;
    }
    this.paused = true;
    if (!this.running) {
      this.running = true;
      this.lastDrawAt = 0;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /** Called after a seek while playback is paused. */
  invalidate(): void {
    if (this.disposed) return;
    const sample = this.config.sample();
    const frame = this.config.timeline.getFrame(sample.time);
    if (frame.lineIndex !== this.lineIndex) {
      const delta =
        this.lastSampleTime === null ? 0 : Math.abs(sample.time - this.lastSampleTime);
      this.beginLine(frame, delta > 0.8);
    } else {
      this.currentFrame = frame;
    }
    this.lastSampleTime = sample.time;
    this.transition.currentAlpha = this.currentComposition ? 1 : 0;
    this.transition.oldAlpha = 0;
    this.transition.edgeProgress = 1;
    this.transition.newDrift = 0;
    this.transition.oldDrift = 0;
    this.drawAt(performance.now(), true);
  }

  private readonly tick = (now: number): void => {
    if (!this.running || this.disposed) return;
    if (!this.paused) this.trackCadence(now);
    const interval = this.paused ? 1000 / 24 : this.minFrameInterval;
    if (interval > 0 && this.lastDrawAt > 0 && now - this.lastDrawAt < interval) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }
    this.drawAt(now, false);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private drawOnce(): void {
    if (this.disposed) return;
    this.drawAt(performance.now(), true);
  }

  private drawAt(now: number, staticFrame: boolean): void {
    // The canvas is a fresh frame every tick. Paint true black rather than
    // relying on a translucent clear, so the reference's void is absolute.
    this.context.save();
    this.context.globalCompositeOperation = 'source-over';
    this.context.fillStyle = '#000000';
    this.context.fillRect(0, 0, this.width, this.height);
    this.context.restore();

    const { sample, frame } = this.sampleNow();
    const delta = this.lastDrawAt > 0 ? Math.min(0.05, (now - this.lastDrawAt) / 1000) : 0.016;
    this.animationDelta = delta;
    this.lastDrawAt = now;

    this.updateSpectrum(delta);
    this.drawEdgeLight(now);

    if (!this.config.reducedMotion) {
      this.pointer.x += (this.pointer.targetX - this.pointer.x) * 0.035;
      this.pointer.y += (this.pointer.targetY - this.pointer.y) * 0.035;
      if (!staticFrame) this.updateMotes(delta);
    }

    this.drawAmbient(now);
    this.drawComposition(this.previousComposition, this.previousFrame, {
      alpha: this.transition.oldAlpha * 0.72,
      drift: this.transition.oldDrift,
      previous: true,
      edgeProgress: 1,
      time: sample.time,
      now,
    });
    this.drawComposition(this.currentComposition, frame, {
      alpha: this.transition.currentAlpha,
      drift: this.transition.newDrift,
      previous: false,
      edgeProgress: this.transition.edgeProgress,
      time: sample.time,
      now,
    });
  }

  /**
   * Fast attack, slow release. Music hits brighten the edge immediately and
   * then settle, which reads as the light reacting to the track rather than
   * flickering with every FFT frame.
   */
  private updateSpectrum(delta: number): void {
    const target = this.config.levels?.() ?? SILENT_SPECTRUM;
    const attack = 1 - Math.exp(-delta * 22);
    const release = 1 - Math.exp(-delta * 4.5);
    const mix = (current: number, next: number): number =>
      current + (next - current) * (next > current ? attack : release);
    const levels = this.spectrum;
    levels.level = mix(levels.level, target.level);
    levels.bass = mix(levels.bass, target.bass);
    levels.mid = mix(levels.mid, target.mid);
    levels.treble = mix(levels.treble, target.treble);
  }

  /**
   * One feathered ellipse of light. Scaling the context turns a radial
   * gradient into a soft horizontal capsule, so the band has no hard edges in
   * either axis.
   */
  private drawEdgeGlow(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rgb: string,
    alpha: number,
  ): void {
    const peak = clamp(alpha);
    if (peak <= 0.002 || radiusX <= 1 || radiusY <= 0.5) return;
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.scale(1, radiusY / radiusX);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
    gradient.addColorStop(0, `rgba(${rgb},${peak})`);
    gradient.addColorStop(0.45, `rgba(${rgb},${clamp(peak * 0.6)})`);
    gradient.addColorStop(0.78, `rgba(${rgb},${clamp(peak * 0.18)})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    context.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
    context.restore();
  }

  private drawEdgeLight(now: number): void {
    const context = this.context;
    const opacity = this.transition.starsAlpha;
    if (opacity <= 0.001) return;
    const intensity = clamp(this.config.intensity, 0.5, 1.35);
    const levels = this.spectrum;
    const inset = clamp(Math.min(this.width, this.height) * 0.012, 8, 18);
    const motion = this.config.reducedMotion ? 0 : 1;

    context.save();
    context.globalCompositeOperation = 'lighter';

    // Segments are drawn independently: no corner joins, no wrap-around, and
    // each capsule fades to zero before the next segment starts.
    for (const bar of this.edgeBars) {
      const band =
        bar.band === 'bass'
          ? levels.bass
          : bar.band === 'mid'
            ? levels.mid
            : bar.band === 'treble'
              ? levels.treble
              : levels.level;
      const energy = clamp(0.3 + band * 1.2);
      const breathe = 0.82 + 0.18 * Math.sin(now * 0.00055 * bar.breatheSpeed + bar.phase) * motion;
      const drift = Math.sin(now * 0.00019 * bar.driftSpeed + bar.phase) * bar.drift * motion;
      const centerX = bar.center * this.width + drift;
      const half = Math.max(70, bar.half * this.width * (1 + band * 0.1));
      const startX = centerX - half;
      const endX = centerX + half;
      const y = bar.edge === 'top' ? inset : this.height - inset;

      // The bright spot slides along the band and swings further when its band
      // is loud, so motion follows the music instead of a fixed timer.
      const sway = Math.sin(now * 0.00085 * bar.hotSpeed + bar.phase) * motion;
      const hotT = clamp(0.5 + sway * (0.16 + band * 0.2), 0.2, 0.8);
      const jitter = Math.sin(now * 0.0016 * bar.hotSpeed + bar.phase) * band * 2.5 * motion;

      const strength = clamp(
        opacity * intensity * bar.weight * energy * breathe * (0.72 + levels.level * 0.6),
      );
      if (strength <= 0.002) continue;

      const hotX = startX + (endX - startX) * hotT;

      // Bloom -> halo -> travelling highlight -> hairline core. Every pass is
      // an ellipse, so the band feathers into the black on all sides.
      this.drawEdgeGlow(
        centerX,
        y,
        half * 1.06,
        46 + band * 28,
        STAGE_TINT,
        strength * 0.44,
      );
      this.drawEdgeGlow(centerX, y, half * 0.98, 18 + band * 12, '166, 128, 255', strength * 0.6);
      this.drawEdgeGlow(
        hotX,
        y + jitter,
        half * 0.45,
        24 + band * 12,
        EDGE_CORE,
        strength * 0.3,
      );
      this.drawEdgeGlow(
        hotX,
        y + jitter,
        half * 0.32,
        3.2 + band * 2.6,
        '236, 222, 255',
        strength * 0.85,
      );
      this.drawEdgeGlow(centerX, y, half * 0.94, 2.2 + band * 2, '186, 154, 255', strength * 0.95);
    }

    context.restore();
  }

  private drawAmbient(now: number): void {
    const context = this.context;
    const starsAlpha = this.transition.starsAlpha;
    if (starsAlpha <= 0.001) return;

    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const star of this.stars) {
      const twinkle = this.config.reducedMotion
        ? 0.82
        : 0.72 + 0.28 * Math.sin(now * 0.00035 * star.speed + star.phase);
      const x = star.nx * this.width + this.pointer.x * star.depth * 7;
      const y = star.ny * this.height + this.pointer.y * star.depth * 5;
      const size = star.size * (this.config.style === 'starfield' ? 1.2 : 1);
      const alpha = clamp(star.alpha * twinkle * starsAlpha * this.config.intensity);
      if (alpha <= 0.01) continue;
      context.fillStyle = `rgba(224, 216, 255, ${alpha})`;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }

    if (!this.config.reducedMotion && this.quality < 1) {
      for (const mote of this.motes) {
        context.fillStyle = `rgba(210, 198, 245, ${clamp(mote.alpha * starsAlpha)})`;
        context.beginPath();
        context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  private updateMotes(delta: number): void {
    for (const mote of this.motes) {
      mote.x += mote.vx * delta;
      mote.y += mote.vy * delta;
      if (mote.y < -30) {
        mote.y = this.height + 20;
        mote.x = Math.random() * this.width;
      }
      if (mote.x < -20) mote.x = this.width + 10;
      if (mote.x > this.width + 20) mote.x = -10;
    }
  }

  private nodePosition(
    composition: Composition,
    node: LayoutNode,
    drift: number,
    word: TimedWord | undefined,
  ): { x: number; y: number } {
    const centerX = composition.width / 2;
    const centerY = composition.height / 2;
    const dx = node.x - centerX;
    const dy = node.y - centerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const driftX = (dx / distance) * drift;
    const driftY = (dy / distance) * drift;
    const reveal = word?.reveal ?? 1;
    return {
      x: node.x + driftX + node.enterX * (1 - reveal) * 0.8,
      y: node.y + driftY + node.enterY * (1 - reveal) * 0.8,
    };
  }

  private targetEnergy(word: TimedWord | undefined): number {
    if (!word) return 0.14;
    if (word.active) return 1;
    if (word.completed) return 0.54;
    return 0.12 + word.reveal * 0.18;
  }

  private spawnHandoff(
    from: { x: number; y: number },
    to: { x: number; y: number },
    now: number,
    fromIndex: number,
    toIndex: number,
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const direction = (fromIndex + toIndex) % 2 === 0 ? 1 : -1;
    const bend = Math.min(150, distance * 0.18) * direction;
    this.handoffs.push({
      from,
      to,
      control: {
        x: (from.x + to.x) / 2 - (dy / distance) * bend,
        y: (from.y + to.y) / 2 + (dx / distance) * bend,
      },
      startedAt: now,
      duration: clamp(320 + distance * 0.24, 360, 640),
    });
    if (this.handoffs.length > 3) this.handoffs.shift();
  }

  private updateWordAnimations(
    composition: Composition,
    frame: TimelineFrame | null,
    points: { x: number; y: number }[],
    now: number,
  ): void {
    if (this.energyComposition !== composition) {
      this.energyComposition = composition;
      this.wordEnergy = composition.nodes.map((_, index) =>
        this.targetEnergy(frame?.words[index]),
      );
      this.lastActiveWord = frame?.words.findIndex((word) => word.active) ?? -1;
    }

    const activeIndex = frame?.words.findIndex((word) => word.active) ?? -1;
    if (activeIndex !== this.lastActiveWord) {
      const previousIndex = this.lastActiveWord;
      this.lastActiveWord = activeIndex;
      if (
        !this.lastSeek &&
        !this.config.reducedMotion &&
        previousIndex >= 0 &&
        activeIndex >= 0 &&
        Math.abs(activeIndex - previousIndex) <= 2
      ) {
        const from = points[previousIndex];
        const to = points[activeIndex];
        if (from && to) this.spawnHandoff(from, to, now, previousIndex, activeIndex);
      }
    }

    const targets = composition.nodes.map((_, index) =>
      this.targetEnergy(frame?.words[index]),
    );
    if (this.lastSeek) {
      this.wordEnergy = targets;
      return;
    }
    const factor = 1 - Math.exp(-this.animationDelta * 11);
    this.wordEnergy = targets.map((target, index) => {
      const current = this.wordEnergy[index] ?? target;
      return current + (target - current) * factor;
    });

    this.handoffs = this.handoffs.filter(
      (handoff) => now - handoff.startedAt < handoff.duration + 220,
    );
  }

  private drawHandoffs(now: number, compositionAlpha: number): void {
    if (this.handoffs.length === 0 || compositionAlpha <= 0.01) return;
    const context = this.context;
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const handoff of this.handoffs) {
      const elapsed = Math.max(0, now - handoff.startedAt);
      const t = clamp(elapsed / handoff.duration);
      const eased = easeInOutCubic(t);
      const life = 1 - smoothstep(clamp((t - 0.62) / 0.38));
      const alpha = compositionAlpha * life;
      if (alpha <= 0.01) continue;
      const head = quadraticPoint(handoff.from, handoff.control, handoff.to, eased);

      const trace = (end: number): void => {
        context.beginPath();
        const steps = Math.max(2, Math.ceil(26 * end));
        for (let step = 0; step <= steps; step += 1) {
          const point = quadraticPoint(
            handoff.from,
            handoff.control,
            handoff.to,
            (end * step) / steps,
          );
          if (step === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
      };

      trace(eased);
      context.strokeStyle = `rgba(${STAGE_TINT},${clamp(0.3 * alpha)})`;
      context.lineWidth = 5;
      context.shadowColor = `rgba(${STAGE_TINT},${clamp(0.7 * alpha)})`;
      context.shadowBlur = 16;
      context.stroke();

      trace(eased);
      context.strokeStyle = `rgba(242, 236, 255,${clamp(0.82 * alpha)})`;
      context.lineWidth = 1.05;
      context.shadowBlur = 7;
      context.stroke();

      // The whole route is sketched faintly from the first frame, so the
      // path between the two words stays legible between beats.
      context.save();
      context.shadowBlur = 0;
      trace(1);
      context.strokeStyle = `rgba(196, 176, 255, ${clamp(0.13 * alpha)})`;
      context.lineWidth = 0.7;
      context.stroke();
      context.restore();

      // The head is a small comet with a fading tail of motes.
      const glowRadius = 26 + 8 * Math.sin(now * 0.012);
      const glow = context.createRadialGradient(
        head.x,
        head.y,
        0,
        head.x,
        head.y,
        glowRadius,
      );
      glow.addColorStop(0, `rgba(255,255,255,${clamp(0.92 * alpha)})`);
      glow.addColorStop(0.28, `rgba(${EDGE_CORE},${clamp(0.55 * alpha)})`);
      glow.addColorStop(1, `rgba(${STAGE_TINT},0)`);
      context.fillStyle = glow;
      context.fillRect(
        head.x - glowRadius,
        head.y - glowRadius,
        glowRadius * 2,
        glowRadius * 2,
      );

      for (let index = 1; index <= 5; index += 1) {
        const trail = quadraticPoint(
          handoff.from,
          handoff.control,
          handoff.to,
          Math.max(0, eased - index * 0.026),
        );
        context.globalAlpha = clamp((0.36 - index * 0.055) * alpha);
        context.fillStyle = `rgb(${EDGE_CORE})`;
        context.beginPath();
        context.arc(trail.x, trail.y, Math.max(0.7, 2.1 - index * 0.28), 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      // A soft ring blooms at the destination as the comet lands.
      if (t > 0.52) {
        const ringT = clamp((t - 0.52) / 0.48);
        context.strokeStyle = `rgba(${EDGE_CORE},${clamp((1 - ringT) * 0.42 * alpha)})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(handoff.to.x, handoff.to.y, 8 + ringT * 36, 0, Math.PI * 2);
        context.stroke();
      }
    }

    context.restore();
  }

  private drawComposition(
    composition: Composition | null,
    frame: TimelineFrame | null,
    options: {
      alpha: number;
      drift: number;
      previous: boolean;
      edgeProgress: number;
      time: number;
      now: number;
    },
  ): void {
    if (!composition || options.alpha <= 0.005) return;
    const points = composition.nodes.map((node) => {
      const word = frame?.words[node.index];
      return this.nodePosition(composition, node, options.drift, word);
    });
    if (!options.previous) {
      this.updateWordAnimations(composition, frame, points, options.now);
    }

    // Edges first, so the words and stars sit in front of the thin lines.
    for (const edge of composition.edges) {
      const from = points[edge.from];
      const to = points[edge.to];
      const fromNode = composition.nodes[edge.from];
      const toNode = composition.nodes[edge.to];
      if (!from || !to || !fromNode || !toNode) continue;
      const delay = options.previous ? 0 : edge.delay * 0.5;
      const progress = smoothstep(clamp((options.edgeProgress - delay) / Math.max(0.08, 1 - delay)));
      if (progress <= 0.001) continue;
      const fromWord = frame?.words[fromNode.index];
      const toWord = frame?.words[toNode.index];
      const activeEdge = Boolean(fromWord?.active || toWord?.active);
      const pulse = activeEdge && !this.config.reducedMotion
        ? 0.72 + 0.28 * Math.sin(options.time * 1.7)
        : 1;
      const edgeAlpha =
        options.alpha *
        (options.previous ? 0.2 : 0.22 + (activeEdge ? 0.13 : 0)) *
        pulse *
        clamp(this.config.intensity, 0.5, 1.35);
      this.drawEdge(from, to, progress, edgeAlpha, options.previous ? 0.75 : 1);
    }

    if (!options.previous) this.drawHandoffs(options.now, options.alpha);

    for (let index = 0; index < composition.nodes.length; index += 1) {
      const node = composition.nodes[index];
      const point = points[index];
      if (!node || !point) continue;
      const energy = options.previous ? 0.32 : this.wordEnergy[index] ?? 0.14;
      // Stars can recede into the map, but the words of the current line must
      // stay readable. These two alphas are deliberately separate.
      const starAlpha = clamp((0.15 + 0.85 * energy) * options.alpha);
      const wordAlpha = clamp((0.12 + 0.88 * energy) * options.alpha);
      const pulse =
        !this.config.reducedMotion && energy > 0.55
          ? 1 + 0.014 * energy * (0.5 + 0.5 * Math.sin(options.time * 2.1))
          : 1;
      this.drawNodeStar(point.x, point.y, node, starAlpha, energy, options.time);
      this.drawWord(node, point, wordAlpha, energy, pulse, options.previous);
    }
  }

  private drawEdge(
    from: { x: number; y: number },
    to: { x: number; y: number },
    progress: number,
    alpha: number,
    glowScale: number,
  ): void {
    const context = this.context;
    const endX = from.x + (to.x - from.x) * progress;
    const endY = from.y + (to.y - from.y) * progress;
    context.save();
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(endX, endY);
    context.strokeStyle = `rgba(210, 198, 238, ${clamp(alpha * 0.52)})`;
    context.lineWidth = 0.58 * glowScale;
    context.stroke();
    context.restore();
  }

  private drawNodeStar(
    x: number,
    y: number,
    node: LayoutNode,
    alpha: number,
    energy: number,
    time: number,
  ): void {
    const context = this.context;
    const pulse = energy > 0.55 && !this.config.reducedMotion
      ? 0.88 + 0.12 * Math.sin(time * 2.3)
      : 1;
    const spark =
      (2.1 + node.starSize * 1.15 + clamp(energy) * (1.1 + node.starSize * 1.05)) * pulse;
    context.save();
    context.globalCompositeOperation = 'lighter';
    if (energy > 0.45) {
      const glow = spark * (2.4 + energy * 2) * this.config.intensity;
      context.globalAlpha = clamp(alpha * 0.2 * energy);
      context.drawImage(this.glowSprite, x - glow, y - glow, glow * 2, glow * 2);
    }
    context.globalAlpha = clamp(alpha * (0.62 + 0.38 * energy));
    context.drawImage(this.sparkSprite, x - spark, y - spark, spark * 2, spark * 2);
    context.restore();
  }

  private drawWord(
    node: LayoutNode,
    point: { x: number; y: number },
    alpha: number,
    energy: number,
    pulse: number,
    previous: boolean,
  ): void {
    if (alpha <= 0.012) return;
    const context = this.context;
    const eased = clamp(energy);
    const fontSize = node.fontSize * (1 + 0.09 * eased);
    const baseline = point.y + node.fontSize * 0.95;
    const textAlpha = clamp(alpha);

    context.save();
    context.translate(point.x, baseline);
    if (node.rotation !== 0) context.rotate((node.rotation * Math.PI) / 180);
    if (pulse !== 1) context.scale(pulse, pulse);
    context.font = wordFont(fontSize, eased > 0.8 ? 800 : eased > 0.34 ? 700 : 600);
    setWordTracking(context, fontSize);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.globalAlpha = textAlpha;
    context.fillStyle = energyColor(eased);
    if (eased > 0.42 && this.config.intensity > 0.4 && !previous) {
      const shimmer = 0.5 + 0.5 * Math.sin(point.x * 0.01 + point.y * 0.01);
      const glow = Math.pow(clamp((eased - 0.42) / 0.58), 1.4);
      context.shadowColor = `rgba(${EDGE_CORE},${clamp(0.66 * glow * this.config.intensity)})`;
      context.shadowBlur = (6 + (14 + shimmer * 10) * glow) * this.config.intensity;
    }
    context.fillText(node.text, 0, 0);
    context.restore();
  }

  private trackCadence(now: number): void {
    if (this.lastQualityCheck === 0) this.lastQualityCheck = now;
    if (this.lastTickTime > 0 && this.quality < 2) {
      const delta = now - this.lastTickTime;
      if (delta > 0 && delta < 250) {
        this.cadenceSum += delta;
        this.cadenceCount += 1;
      }
    }
    this.lastTickTime = now;
    if (this.cadenceCount < 120) return;
    const average = this.cadenceSum / this.cadenceCount;
    this.cadenceSum = 0;
    this.cadenceCount = 0;
    if (now - this.lastQualityCheck < 4200) return;
    this.lastQualityCheck = now;
    if (average > 38) this.setQuality(2);
    else if (average > 28) this.setQuality(1);
  }

  private lastTickTime = 0;
  private cadenceSum = 0;
  private cadenceCount = 0;

  private setQuality(level: number): void {
    if (level <= this.quality) return;
    this.quality = level;
    this.minFrameInterval = level >= 2 ? 32 : 0;
    this.buildAmbientField();
    this.resizeCanvas();
    this.rebuildCurrentComposition();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    gsap.killTweensOf(this.transition);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.currentComposition = null;
    this.previousComposition = null;
    this.stars = [];
    this.motes = [];
    this.edgeBars = [];
    this.spectrum = { ...SILENT_SPECTRUM };
    this.handoffs = [];
    this.wordEnergy = [];
    this.energyComposition = null;
    this.context.clearRect(0, 0, this.width, this.height);
  }
}
