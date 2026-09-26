import { SAMPLE_RATE, type Reconstruction } from "./resynthesis.ts";
export type SoundWindow = [number, number];
export type SoundCapture = {
  samples: Float32Array;
  window: SoundWindow;
  appliedModel?: Reconstruction;
  appliedWindow?: SoundWindow;
  count?: number;
  wave?: "sine" | "triangle" | "square";
};
export const MIN_WINDOW = Math.round(SAMPLE_RATE * 0.08);
export function moveWindow(
  window: SoundWindow,
  edge: 0 | 1,
  sample: number,
  length: number,
): SoundWindow {
  if (!Number.isFinite(sample)) return window;
  const next: SoundWindow = [...window];
  next[edge] =
    edge === 0
      ? Math.max(0, Math.min(window[1] - MIN_WINDOW, Math.round(sample)))
      : Math.min(length, Math.max(window[0] + MIN_WINDOW, Math.round(sample)));
  return next;
}
export function selectedSound(capture: SoundCapture) {
  return capture.samples.slice(capture.window[0], capture.window[1]);
}
export function waveformPeaks(samples: Float32Array, columns: number) {
  return Array.from({ length: columns }, (_, x) => {
    let min = 0,
      max = 0;
    const start = Math.floor((x * samples.length) / columns);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor(((x + 1) * samples.length) / columns)),
    );
    for (let i = start; i < end; i++) {
      min = Math.min(min, samples[i]);
      max = Math.max(max, samples[i]);
    }
    return [min, max] as const;
  });
}
