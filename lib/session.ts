export type Wave = "sine" | "triangle" | "sawtooth" | "square" | "noise";
export type Clip = { name: string; notes: number[] };
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
  kind: "synth" | "kick" | "hat";
};
export type Project = {
  version: 1;
  name: string;
  bpm: number;
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
const pattern = (steps: number[], notes: number[] = []) =>
  Array.from({ length: 16 }, (_, i) =>
    steps.includes(i) ? (notes[steps.indexOf(i)] ?? 0) : -1,
  );
export function makeTrack(i: number): Track {
  return {
    id: crypto.randomUUID(),
    name: `Synth ${i + 1}`,
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
    clips: [
      { name: "Pattern 1", notes: pattern([0, 4, 8, 12]) },
      null,
      null,
      null,
    ],
  };
}
export function initialProject(): Project {
  const specs: [
    string,
    Wave,
    number,
    "synth" | "kick" | "hat",
    number[],
    number[],
  ][] = [
    ["Kick", "sine", 55, "kick", [0, 4, 8, 12], []],
    ["Hi-hat", "noise", 440, "hat", [2, 6, 10, 14], []],
    [
      "Bass",
      "sawtooth",
      65.41,
      "synth",
      [0, 3, 6, 8, 11, 14],
      [0, 0, 7, 0, 3, 7],
    ],
    ["Keys", "triangle", 261.63, "synth", [0, 6, 10], [0, 7, 3]],
    ["Pad", "sine", 130.81, "synth", [0, 8], [0, 7]],
    ["Lead", "square", 523.25, "synth", [0, 3, 7, 10, 14], [0, 7, 12, 10, 7]],
  ];
  return {
    version: 1,
    name: "Untitled session",
    bpm: 120,
    master: 0.8,
    compressor: -18,
    tracks: specs.map(([name, wave, frequency, kind, steps, notes], i) => ({
      ...makeTrack(i),
      id: `track-${i}`,
      name,
      wave,
      frequency,
      kind,
      active: i < 4 ? 0 : -1,
      volume: [0.85, 0.35, 0.5, 0.4, 0.4, 0.22][i],
      cutoff: i === 2 ? 950 : 6000,
      attack: i === 4 ? 0.4 : 0.008,
      decay: i === 4 ? 1.7 : i === 1 ? 0.07 : 0.3,
      reverb: i === 3 ? 0.35 : i === 4 ? 0.5 : 0.05,
      echo: i === 3 ? 0.2 : 0,
      clips: [
        {
          name: [
            "Four on the floor",
            "Offbeat",
            "Low tide",
            "Soft keys",
            "Slow drift",
            "Spark",
          ][i],
          notes: pattern(steps, notes),
        },
        i < 5
          ? {
              name: [
                "Broken beat",
                "Shuffled",
                "Undertow",
                "Night keys",
                "Wide open",
              ][i],
              notes: pattern(
                steps.map((x) => (x + 2) % 16),
                notes,
              ),
            }
          : null,
        i === 0 || i === 2
          ? {
              name: i === 0 ? "Half time" : "Sub motion",
              notes: pattern([0, 8], [0, 7]),
            }
          : null,
        null,
      ],
    })),
  };
}
const bounded = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function parseProject(raw: string): Project {
  const p = JSON.parse(raw);
  if (
    p.version !== 1 ||
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
  for (const t of p.tracks) {
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      typeof t.name !== "string" ||
      t.name.length > 40 ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !["sine", "triangle", "square", "sawtooth", "noise"].includes(t.wave) ||
      !["synth", "kick", "hat"].includes(t.kind) ||
      typeof t.mute !== "boolean" ||
      typeof t.solo !== "boolean" ||
      !Number.isInteger(t.active) ||
      !bounded(t.active, -1, 3) ||
      !Array.isArray(t.clips) ||
      t.clips.length !== 4
    )
      throw Error("Invalid track settings.");
    ids.add(t.id);
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
    for (const c of t.clips)
      if (
        c !== null &&
        (typeof c.name !== "string" ||
          c.name.length > 60 ||
          !Array.isArray(c.notes) ||
          c.notes.length !== 16 ||
          c.notes.some(
            (n: unknown) => !Number.isInteger(n) || !bounded(n, -1, 24),
          ))
      )
        throw Error("Invalid note pattern.");
    if (t.active >= 0 && !t.clips[t.active])
      throw Error("Active clip is missing.");
  }
  return p;
}
