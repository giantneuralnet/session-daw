import type { Track } from "./session";
type Sound = Pick<
  Track,
  | "wave"
  | "kind"
  | "frequency"
  | "attack"
  | "decay"
  | "cutoff"
  | "reverb"
  | "echo"
>;
export const soundPresets: {
  name: string;
  group: "Drums" | "Synths";
  sound: Sound;
}[] = [
  {
    name: "Kick",
    group: "Drums",
    sound: {
      wave: "sine",
      kind: "kick",
      frequency: 52,
      attack: 0.001,
      decay: 0.32,
      cutoff: 2500,
      reverb: 0,
      echo: 0,
    },
  },
  {
    name: "Snare",
    group: "Drums",
    sound: {
      wave: "noise",
      kind: "hat",
      frequency: 180,
      attack: 0.001,
      decay: 0.2,
      cutoff: 1200,
      reverb: 0.12,
      echo: 0,
    },
  },
  {
    name: "Closed hat",
    group: "Drums",
    sound: {
      wave: "noise",
      kind: "hat",
      frequency: 440,
      attack: 0.001,
      decay: 0.045,
      cutoff: 7500,
      reverb: 0,
      echo: 0,
    },
  },
  {
    name: "Open hat",
    group: "Drums",
    sound: {
      wave: "noise",
      kind: "hat",
      frequency: 440,
      attack: 0.001,
      decay: 0.42,
      cutoff: 6500,
      reverb: 0.1,
      echo: 0,
    },
  },
  {
    name: "Clap",
    group: "Drums",
    sound: {
      wave: "noise",
      kind: "hat",
      frequency: 440,
      attack: 0.008,
      decay: 0.12,
      cutoff: 2000,
      reverb: 0.25,
      echo: 0,
    },
  },
  {
    name: "Tom",
    group: "Drums",
    sound: {
      wave: "sine",
      kind: "kick",
      frequency: 115,
      attack: 0.002,
      decay: 0.24,
      cutoff: 1600,
      reverb: 0.1,
      echo: 0,
    },
  },
  {
    name: "Sub bass",
    group: "Synths",
    sound: {
      wave: "sine",
      kind: "synth",
      frequency: 65.41,
      attack: 0.008,
      decay: 0.14,
      cutoff: 700,
      reverb: 0,
      echo: 0,
    },
  },
  {
    name: "Acid bass",
    group: "Synths",
    sound: {
      wave: "sawtooth",
      kind: "synth",
      frequency: 65.41,
      attack: 0.003,
      decay: 0.18,
      cutoff: 1100,
      reverb: 0.05,
      echo: 0.1,
    },
  },
  {
    name: "Soft keys",
    group: "Synths",
    sound: {
      wave: "triangle",
      kind: "synth",
      frequency: 261.63,
      attack: 0.008,
      decay: 0.45,
      cutoff: 4200,
      reverb: 0.3,
      echo: 0.15,
    },
  },
  {
    name: "Warm pad",
    group: "Synths",
    sound: {
      wave: "sine",
      kind: "synth",
      frequency: 130.81,
      attack: 0.5,
      decay: 1.8,
      cutoff: 2200,
      reverb: 0.55,
      echo: 0.1,
    },
  },
  {
    name: "Lead",
    group: "Synths",
    sound: {
      wave: "square",
      kind: "synth",
      frequency: 261.63,
      attack: 0.01,
      decay: 0.2,
      cutoff: 2800,
      reverb: 0.15,
      echo: 0.25,
    },
  },
  {
    name: "Bell",
    group: "Synths",
    sound: {
      wave: "sine",
      kind: "synth",
      frequency: 880,
      attack: 0.001,
      decay: 1.4,
      cutoff: 12000,
      reverb: 0.4,
      echo: 0.22,
    },
  },
];
