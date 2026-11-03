import { describe, expect, it } from 'vitest';
import { getCanvasMetrics, MAX_CANVAS_PIXELS } from '@/features/constellation/canvasMetrics';

describe('getCanvasMetrics', () => {
  it('uses integer CSS dimensions and a capped device pixel ratio', () => {
    const metrics = getCanvasMetrics(1280.4, 720.6, 3);
    expect(metrics.cssWidth).toBe(1280);
    expect(metrics.cssHeight).toBe(721);
    expect(metrics.dpr).toBe(2);
    expect(metrics.pixelWidth).toBe(2560);
    expect(metrics.pixelHeight).toBe(1442);
  });

  it('keeps the backing store within the total pixel budget', () => {
    const metrics = getCanvasMetrics(3840, 2160, 2, 2);
    const pixels = metrics.pixelWidth * metrics.pixelHeight;
    expect(pixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 5000);
    expect(metrics.dpr).toBeLessThan(2);
    expect(metrics.dpr).toBeGreaterThanOrEqual(0.75);
  });

  it('never returns zero or invalid dimensions', () => {
    const metrics = getCanvasMetrics(0, Number.NaN, Number.NaN);
    expect(metrics.cssWidth).toBe(1);
    expect(metrics.cssHeight).toBe(1);
    expect(metrics.dpr).toBeGreaterThanOrEqual(0.75);
    expect(metrics.pixelWidth).toBeGreaterThanOrEqual(1);
    expect(metrics.pixelHeight).toBeGreaterThanOrEqual(1);
  });

  it('honours a reduced quality cap', () => {
    const full = getCanvasMetrics(1280, 720, 2, 2);
    const reduced = getCanvasMetrics(1280, 720, 2, 1);
    expect(full.pixelWidth).toBeGreaterThan(reduced.pixelWidth);
    expect(reduced.dpr).toBe(1);
  });
});
