// Short-time Fourier analysis. The saved instrument contains sinusoid
// frequencies, amplitudes and phases, never the microphone PCM.
export const MAX_PARTIALS = 32;
export type ConstructionWave = "sine" | "triangle" | "square";
export const SAMPLE_RATE = 24000;
export const FFT_SIZE = 4096;
export const HOP_SIZE = 1024;
export const MAX_SECONDS = 5;
export type Partial = { frequency: number; amplitude: number; phase: number };
export type Reconstruction = {
  format: "spectral-v1";
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  length: number;
  referenceFrequency: number;
  count: number;
  wave?: ConstructionWave;
  frames: Partial[][];
};

// In-place radix-2 FFT, inverse normalized by N.
export function fft(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < size / 2; j++) {
        const c = Math.cos(angle * j),
          s = Math.sin(angle * j);
        const a = start + j,
          b = a + size / 2;
        const r = real[b] * c - imag[b] * s;
        const im = real[b] * s + imag[b] * c;
        real[b] = real[a] - r;
        imag[b] = imag[a] - im;
        real[a] += r;
        imag[a] += im;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
}
const round = (v: number) => +v.toFixed(7);
const windowAt = (i: number) =>
  0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);

// Remove the pause around a take so short piano-roll notes hit the sound's attack.
export function trimSound(samples: Float32Array): Float32Array {
  const block = 240;
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += block) {
    let sum = 0;
    for (let i = start; i < Math.min(start + block, samples.length); i++)
      sum += samples[i] ** 2;
    levels.push(Math.sqrt(sum / block));
  }
  const threshold = Math.max(0.0001, Math.max(...levels) * 0.04);
  const first = levels.findIndex((v) => v >= threshold);
  if (first < 0) return samples;
  let last = levels.length - 1;
  while (last > first && levels[last] < threshold) last--;
  const start = Math.max(0, first * block - Math.round(SAMPLE_RATE * 0.01));
  const end = Math.min(
    samples.length,
    Math.max(
      start + SAMPLE_RATE * 0.1,
      (last + 1) * block + Math.round(SAMPLE_RATE * 0.1),
    ),
  );
  return samples.slice(start, end);
}

export function analyzeSound(samples: Float32Array): Reconstruction {
  if (
    samples.length < SAMPLE_RATE * 0.08 ||
    samples.length > SAMPLE_RATE * MAX_SECONDS
  )
    throw Error("Record a sound between 0.1 and 5 seconds.");
  let energy = 0;
  for (const v of samples) {
    if (!Number.isFinite(v)) throw Error("Invalid recording.");
    energy += v * v;
  }
  if (Math.sqrt(energy / samples.length) < 0.0001)
    throw Error("No sound detected. Try recording closer to the microphone.");
  const frames: Partial[][] = [];
  const strength = new Float64Array(FFT_SIZE / 2);
  // Centered, zero-padded frames preserve the attack and release at both ends.
  for (
    let center = 0;
    center < samples.length + FFT_SIZE / 2;
    center += HOP_SIZE
  ) {
    const real = new Float64Array(FFT_SIZE),
      imag = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++)
      real[i] = (samples[center - FFT_SIZE / 2 + i] ?? 0) * windowAt(i);
    fft(real, imag);
    const partials: Partial[] = [];
    for (let bin = 2; bin < FFT_SIZE / 2; bin++) {
      const amplitude = (2 * Math.hypot(real[bin], imag[bin])) / FFT_SIZE;
      if (amplitude < 0.0000001) continue;
      strength[bin] += amplitude * amplitude;
      partials.push({
        frequency: (bin * SAMPLE_RATE) / FFT_SIZE,
        amplitude: round(amplitude),
        phase: round(Math.atan2(imag[bin], real[bin])),
      });
    }
    partials.sort((a, b) => b.amplitude - a.amplitude);
    frames.push(partials.slice(0, MAX_PARTIALS));
  }
  let referenceBin = Math.round((440 * FFT_SIZE) / SAMPLE_RATE);
  for (
    let bin = Math.ceil((40 * FFT_SIZE) / SAMPLE_RATE);
    (bin * SAMPLE_RATE) / FFT_SIZE <= 2000;
    bin++
  )
    if (strength[bin] > strength[referenceBin]) referenceBin = bin;
  return {
    format: "spectral-v1",
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
    hopSize: HOP_SIZE,
    length: samples.length,
    referenceFrequency: (referenceBin * SAMPLE_RATE) / FFT_SIZE,
    count: 32,
    wave: "sine",
    frames,
  };
}

export function renderSound(model: Reconstruction): Float32Array {
  const output = new Float32Array(model.length),
    weight = new Float32Array(model.length);
  model.frames.forEach((frame, f) => {
    const real = new Float64Array(FFT_SIZE),
      imag = new Float64Array(FFT_SIZE);
    for (const p of frame.slice(0, Math.min(model.count, MAX_PARTIALS))) {
      const bin = Math.round((p.frequency * FFT_SIZE) / SAMPLE_RATE);
      const magnitude = (p.amplitude * FFT_SIZE) / 2;
      const wave = model.wave ?? "sine";
      // Band-limited odd-harmonic series, aligned to the FFT's cosine phase.
      // Each selected component is one sine, triangle, or square oscillator.
      const limit = wave === "sine" ? 1 : Math.floor((FFT_SIZE / 2 - 1) / bin);
      for (let harmonic = 1; harmonic <= limit; harmonic += 2) {
        const coefficient =
          wave === "sine"
            ? 1
            : wave === "triangle"
              ? 8 / (Math.PI ** 2 * harmonic ** 2)
              : (4 / Math.PI) * ((harmonic % 4 === 1 ? 1 : -1) / harmonic);
        const target = bin * harmonic;
        const phase = p.phase * harmonic;
        const r = Math.cos(phase) * magnitude * coefficient;
        const im = Math.sin(phase) * magnitude * coefficient;
        real[target] += r;
        imag[target] += im;
        real[FFT_SIZE - target] += r;
        imag[FFT_SIZE - target] -= im;
      }
    }
    fft(real, imag, true);
    for (let i = 0; i < FFT_SIZE; i++) {
      const position = f * HOP_SIZE - FFT_SIZE / 2 + i;
      if (position < 0 || position >= output.length) continue;
      const w = windowAt(i);
      output[position] += real[i] * w;
      weight[position] += w * w;
    }
  });
  let peak = 0;
  for (let i = 0; i < output.length; i++) {
    output[i] = weight[i] > 0 ? output[i] / weight[i] : 0;
    peak = Math.max(peak, Math.abs(output[i]));
  }
  // Only attenuate overloads. Quality comparisons keep the same input gain.
  if (peak > 0.98)
    for (let i = 0; i < output.length; i++) output[i] *= 0.98 / peak;
  return output;
}

export function validReconstruction(value: unknown): value is Reconstruction {
  if (!value || typeof value !== "object") return false;
  const m = value as Reconstruction;
  if (
    m.format !== "spectral-v1" ||
    m.sampleRate !== SAMPLE_RATE ||
    m.fftSize !== FFT_SIZE ||
    m.hopSize !== HOP_SIZE ||
    !Number.isInteger(m.length) ||
    m.length < SAMPLE_RATE * 0.08 ||
    m.length > SAMPLE_RATE * MAX_SECONDS ||
    !Number.isInteger(m.count) ||
    m.count < 1 ||
    m.count > (m.wave === undefined ? 128 : MAX_PARTIALS) ||
    (m.wave !== undefined &&
      !["sine", "triangle", "square"].includes(m.wave)) ||
    !Number.isFinite(m.referenceFrequency) ||
    m.referenceFrequency < 20 ||
    m.referenceFrequency > 2000 ||
    !Array.isArray(m.frames) ||
    m.frames.length !== Math.ceil((m.length + FFT_SIZE / 2) / HOP_SIZE)
  )
    return false;
  return m.frames.every((frame) => {
    if (
      !Array.isArray(frame) ||
      frame.length > (m.wave === undefined ? 128 : MAX_PARTIALS)
    )
      return false;
    const bins = new Set<number>();
    return frame.every((p) => {
      if (
        !p ||
        !Number.isFinite(p.frequency) ||
        !Number.isFinite(p.amplitude) ||
        !Number.isFinite(p.phase)
      )
        return false;
      const bin = (p.frequency * FFT_SIZE) / SAMPLE_RATE;
      if (
        !Number.isInteger(bin) ||
        bin < 2 ||
        bin >= FFT_SIZE / 2 ||
        bins.has(bin) ||
        p.amplitude < 0 ||
        p.amplitude > 2 ||
        Math.abs(p.phase) > Math.PI + 0.0000001
      )
        return false;
      bins.add(bin);
      return true;
    });
  });
}

const renderedSounds = new WeakMap<Reconstruction, Float32Array>();
export function rememberRenderedSound(
  model: Reconstruction,
  samples: Float32Array,
) {
  renderedSounds.set(model, samples);
}
export function renderedSound(model: Reconstruction) {
  let samples = renderedSounds.get(model);
  if (!samples) {
    samples = renderSound(model);
    renderedSounds.set(model, samples);
  }
  return samples;
}
