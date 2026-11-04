export interface SpectrumLevels {
  /** Overall loudness, 0..1. */
  level: number;
  /** Low end, 0..1. */
  bass: number;
  /** Mids, 0..1. */
  mid: number;
  /** High end, 0..1. */
  treble: number;
}

export const SILENT_SPECTRUM: SpectrumLevels = {
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Average a band of FFT bins into a curved 0..1 value. */
export function averageBand(
  data: Uint8Array,
  from: number,
  to: number,
): number {
  const start = Math.max(0, Math.min(data.length - 1, from));
  const end = Math.max(start + 1, Math.min(data.length, to));
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += data[index] ?? 0;
  }
  const average = sum / (end - start) / 255;
  return clamp01(Math.pow(average, 1.35) * 1.25);
}
