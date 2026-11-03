export interface CanvasMetrics {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  pixelWidth: number;
  pixelHeight: number;
}

export const MAX_CANVAS_PIXELS = 8_200_000;

/**
 * Computes the backing-store size for a high-DPI canvas. The DPR is limited
 * both explicitly and by a total-pixel budget so a 4K/200%-scaled display does
 * not allocate an unnecessarily enormous buffer.
 */
export function getCanvasMetrics(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr = 2,
  maxPixels = MAX_CANVAS_PIXELS,
): CanvasMetrics {
  const width = Math.max(1, Math.round(Number.isFinite(cssWidth) ? cssWidth : 1));
  const height = Math.max(1, Math.round(Number.isFinite(cssHeight) ? cssHeight : 1));
  const rawDpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelBudgetDpr = Math.sqrt(maxPixels / Math.max(1, width * height));
  const dpr = Math.max(0.75, Math.min(rawDpr, maxDpr, pixelBudgetDpr));
  return {
    cssWidth: width,
    cssHeight: height,
    dpr: Math.round(dpr * 1000) / 1000,
    pixelWidth: Math.max(1, Math.round(width * dpr)),
    pixelHeight: Math.max(1, Math.round(height * dpr)),
  };
}
