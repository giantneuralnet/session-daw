import {
  validReconstruction,
  MAX_PARTIALS,
  type Reconstruction,
} from "./resynthesis.ts";
export const MIN_PITCH = -36;
export const MAX_PITCH = 60;
export const MAX_STEPS = 128;
export type TimeSignature = [number, number];
export const signatureOf = (p: {
  timeSignature?: TimeSignature;
}): TimeSignature => p.timeSignature ?? [4, 4];
export const stepsPerBar = (p: { timeSignature?: TimeSignature }) => {
  const [beats, unit] = signatureOf(p);
  return (beats * 16) / unit;
};
export type Wave = "sine" | "triangle" | "sawtooth" | "square" | "noise";
export type Note = { id: string; start: number; pitch: number; length: number };
export type Clip = { notes: Note[] };
export type Track = {
  id: string;
  name: string;
  color: string;
  wave: Wave;
  frequency: number;
  attack: number;
  decay: number;
  cutoff: number;
  volume: number;
  pan: number;
  reverb: number;
  echo: number;
  mute: boolean;
  solo: boolean;
  active: number;
  clips: (Clip | null)[];
  kind: "synth" | "kick" | "hat" | "recorded";
  reconstruction?: Reconstruction;
};
export type Project = {
  version: 2;
  name: string;
  bpm: number;
  timeSignature?: TimeSignature;
  master: number;
  compressor: number;
  tracks: Track[];
};
export const colors = [
  "#d6a869",
  "#9aba98",
  "#a89bdd",
  "#cf8eae",
  "#7eafca",
  "#d2c276",
];
export const columnLabel = (i: number) => String.fromCharCode(65 + i);
const pattern = (steps: number[], pitches: number[] = []) =>
  steps.map((start, i) => ({
    id: `n-${i}`,
    start,
    pitch: pitches[i] ?? 0,
    length: 1,
  }));
export function makeTrack(i: number, rows = 4): Track {
  return {
    id: crypto.randomUUID(),
    name: columnLabel(i),
    color: colors[i % 6],
    wave: "sine",
    frequency: 220,
    attack: 0.01,
    decay: 0.3,
    cutoff: 6000,
    volume: 0.65,
    pan: 0,
    reverb: 0.12,
    echo: 0,
    mute: false,
    solo: false,
    active: -1,
    kind: "synth",
    clips: Array.from({ length: rows }, (_, j) =>
      j === 0 ? { notes: [] } : null,
    ),
  };
}
export function emptyProject(): Project {
  return {
    version: 2,
    name: "Session",
    bpm: 120,
    timeSignature: [4, 4],
    master: 0.8,
    compressor: -18,
    tracks: [makeTrack(0)],
  };
}
export function addRow(p: Project): Project {
  if (p.tracks[0].clips.length >= 64) return p;
  return {
    ...p,
    tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips, null] })),
  };
}
export function ensureEmptyRow(p: Project): Project {
  return p.tracks.some((t) => t.clips.every((c) => c !== null)) ? addRow(p) : p;
}
export function initialProject(): Project {
  const specs: [Wave, number, Track["kind"], number[], number[]][] = [
    ["sine", 55, "kick", [0, 4, 8, 12], []],
    ["noise", 440, "hat", [2, 6, 10, 14], []],
    ["sawtooth", 65.41, "synth", [0, 3, 6, 8, 11, 14], [0, 0, 7, 0, 3, 7]],
    ["triangle", 261.63, "synth", [0, 6, 10], [0, 7, 3]],
    ["sine", 130.81, "synth", [0, 8], [0, 7]],
    ["square", 523.25, "synth", [0, 3, 7, 10, 14], [0, 7, 12, 10, 7]],
  ];
  return {
    ...emptyProject(),
    tracks: specs.map(([wave, frequency, kind, steps, pitches], i) => ({
      ...makeTrack(i),
      id: `track-${i}`,
      wave,
      frequency,
      kind,
      active: -1,
      volume: [0.85, 0.35, 0.5, 0.4, 0.4, 0.22][i],
      cutoff: i === 2 ? 950 : 6000,
      attack: i === 4 ? 0.4 : 0.008,
      decay: i === 4 ? 1.7 : i === 1 ? 0.07 : 0.3,
      reverb: i === 3 ? 0.35 : i === 4 ? 0.5 : 0.05,
      echo: i === 3 ? 0.2 : 0,
      clips: [
        { notes: pattern(steps, pitches) },
        i < 5
          ? {
              notes: pattern(
                steps.map((x) => (x + 2) % 16),
                pitches,
              ),
            }
          : null,
        i === 0 || i === 2 ? { notes: pattern([0, 8], [0, 7]) } : null,
        null,
      ],
    })),
  };
}
const bounded = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && bounded(v, min, max);
export function parseProject(raw: string): Project {
  const p = JSON.parse(raw);
  if (
    !p ||
    ![1, 2].includes(p.version) ||
    typeof p.name !== "string" ||
    p.name.length > 80 ||
    !bounded(p.bpm, 40, 240) ||
    !bounded(p.master, 0, 1) ||
    !bounded(p.compressor, -60, 0) ||
    !Array.isArray(p.tracks) ||
    !p.tracks.length ||
    p.tracks.length > 16
  )
    throw Error("Invalid session file.");
  const ids = new Set();
  if (
    p.timeSignature !== undefined &&
    (!Array.isArray(p.timeSignature) ||
      p.timeSignature.length !== 2 ||
      !integer(p.timeSignature[0], 1, 16) ||
      ![2, 4, 8, 16].includes(p.timeSignature[1]))
  )
    throw Error("Invalid time signature.");
  // Notes beyond a shortened bar remain in JSON, ready when the bar expands.
  const noteLimit = p.timeSignature === undefined ? 16 : MAX_STEPS;
  const rows = p.tracks[0]?.clips?.length;
  if (!integer(rows, 1, 64)) throw Error("Invalid row count.");
  for (const t of p.tracks) {
    if (
      !t ||
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      typeof t.name !== "string" ||
      t.name.length > 40 ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !["sine", "triangle", "square", "sawtooth", "noise"].includes(t.wave) ||
      !["synth", "kick", "hat", "recorded"].includes(t.kind) ||
      typeof t.mute !== "boolean" ||
      typeof t.solo !== "boolean" ||
      !integer(t.active, -1, rows - 1) ||
      !Array.isArray(t.clips) ||
      t.clips.length !== rows
    )
      throw Error("Invalid track settings.");
    ids.add(t.id);
    if (
      (t.reconstruction !== undefined &&
        !validReconstruction(t.reconstruction)) ||
      (t.kind === "recorded" && !t.reconstruction)
    )
      throw Error("Invalid recorded instrument.");
    if (t.reconstruction && t.reconstruction.wave === undefined) {
      t.reconstruction = {
        ...t.reconstruction,
        wave: "sine",
        count: Math.min(t.reconstruction.count, MAX_PARTIALS),
        frames: t.reconstruction.frames.map(
          (frame: Reconstruction["frames"][number]) =>
            frame.slice(0, MAX_PARTIALS),
        ),
      };
    }
    for (const [key, min, max] of [
      ["frequency", 20, 2000],
      ["attack", 0.001, 2],
      ["decay", 0.03, 3],
      ["cutoff", 80, 18000],
      ["volume", 0, 1],
      ["pan", -1, 1],
      ["reverb", 0, 1],
      ["echo", 0, 0.8],
    ] as const)
      if (!bounded(t[key], min, max)) throw Error("Invalid sound settings.");
    t.clips = t.clips.map((c: Clip | null) => {
      if (c === null) return null;
      if (!c || !Array.isArray(c.notes)) throw Error("Invalid note pattern.");
      if (p.version === 1) {
        const notes = c.notes as unknown as number[];
        if (notes.length !== 16 || notes.some((n) => !integer(n, -1, 24)))
          throw Error("Invalid note pattern.");
        return {
          notes: notes.flatMap((pitch, start) =>
            pitch < 0 ? [] : [{ id: `n-${start}`, start, pitch, length: 1 }],
          ),
        };
      }
      const noteIds = new Set();
      if (c.notes.length > noteLimit * (MAX_PITCH - MIN_PITCH + 1))
        throw Error("Too many notes.");
      for (const n of c.notes) {
        if (
          !n ||
          typeof n.id !== "string" ||
          noteIds.has(n.id) ||
          !integer(n.start, 0, noteLimit - 1) ||
          !integer(n.pitch, MIN_PITCH, MAX_PITCH) ||
          !integer(n.length, 1, noteLimit - n.start)
        )
          throw Error("Invalid note pattern.");
        noteIds.add(n.id);
      }
      return {
        notes: c.notes.map((n) => ({
          id: n.id,
          start: n.start,
          pitch: n.pitch,
          length: n.length,
        })),
      };
    });
    if (t.active >= 0 && !t.clips[t.active])
      throw Error("Active clip is missing.");
  }
  return { ...p, version: 2 };
}
