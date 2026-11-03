import type { ConstellationStyle } from '@shared/ipc';
import type { LyricTimeline } from '@/features/lyrics/timeline';

export interface ExperienceSession {
  timeline: LyricTimeline;
  mediaToken: string;
  style: ConstellationStyle;
  intensity: number;
  reducedMotion: boolean;
  temporaryControls: boolean;
}
