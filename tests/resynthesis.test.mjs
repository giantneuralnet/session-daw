import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  analyzeSound,
  renderSound,
  fft,
  validReconstruction,
  trimSound,
  SAMPLE_RATE,
  FFT_SIZE,
} from "../lib/resynthesis.ts";
import { parseProject, emptyProject } from "../lib/session.ts";
import { microphoneError, MicrophoneRecording } from "../lib/microphone.ts";

const signal = (seconds, fn) =>
  Float32Array.from({ length: Math.round(SAMPLE_RATE * seconds) }, (_, i) =>
    fn(i / SAMPLE_RATE),
  );
const mse = (a, b) =>
  a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length;
const tone = (hz, t) => Math.sin(2 * Math.PI * hz * t);

test("microphone pauses are trimmed without cutting the attack or release", () => {
  const input = signal(2, (t) =>
    t >= 0.5 && t < 0.9 ? 0.4 * tone(440, t) : 0,
  );
  const trimmed = trimSound(input);
  assert.ok(trimmed.length < SAMPLE_RATE * 0.6);
  assert.ok(trimmed.length > SAMPLE_RATE * 0.4);
  const firstSound = trimmed.findIndex((v) => Math.abs(v) > 0.1);
  assert.ok(firstSound < SAMPLE_RATE * 0.02);
});

test("FFT and inverse preserve amplitude and phase", () => {
  const real = Float64Array.from(
    { length: FFT_SIZE },
    (_, i) => Math.sin(i * 0.14) + Math.cos(i * 0.31),
  );
  const input = real.slice(),
    imag = new Float64Array(real.length);
  fft(real, imag);
  fft(real, imag, true);
  assert.ok(mse(input, real) < 1e-20);
});
test("more components recover a changing multi-tone sound, including attack and decay", () => {
  const input = signal(0.7, (t) => {
    const envelope = Math.min(1, t / 0.02) * Math.max(0, 1 - t / 0.7);
    return (
      envelope *
      (0.25 * tone(220, t) +
        0.15 * tone(443, t) +
        0.1 * tone(931, t) +
        0.06 * tone(2192, t))
    );
  });
  const model = analyzeSound(input);
  assert.ok(validReconstruction(model));
  const low = renderSound({ ...model, count: 1 });
  const middle = renderSound({ ...model, count: 16 });
  const high = renderSound({ ...model, count: 128 });
  assert.equal(high.length, input.length);
  assert.ok(mse(input, high) < mse(input, middle));
  assert.ok(mse(input, middle) < mse(input, low) / 20);
  assert.ok(mse(input, high) < 1e-7, `Error: ${mse(input, high)}`);
  const frequencies = model.frames[4].map((p) => p.frequency);
  for (const hz of [220, 443, 931, 2192])
    assert.ok(
      frequencies.some((f) => Math.abs(f - hz) < SAMPLE_RATE / FFT_SIZE),
    );
  assert.ok(high.every(Number.isFinite));
});
test("chirps and transients retain time evolution, rather than a frozen FFT snapshot", () => {
  const input = signal(
    0.8,
    (t) =>
      0.35 *
      Math.sin(2 * Math.PI * (160 * t + 1100 * t * t)) *
      (t < 0.4 ? 1 : 0.3),
  );
  const model = analyzeSound(input);
  assert.ok(
    Math.abs(model.frames[4][0].frequency - model.frames[14][0].frequency) >
      300,
  );
  assert.ok(mse(input, renderSound({ ...model, count: 128 })) < 0.0001);
});
test("spectral instruments round-trip JSON without storing samples and reject malformed data", () => {
  const p = emptyProject();
  p.tracks[0].kind = "recorded";
  p.tracks[0].reconstruction = analyzeSound(
    signal(0.2, (t) => 0.3 * tone(440, t)),
  );
  const json = JSON.stringify(p);
  assert.ok(!json.includes('"samples"') && !json.includes('"waveform"'));
  assert.deepEqual(parseProject(json), p);
  for (const corrupt of [
    (m) => (m.count = 129),
    (m) => (m.length = 240000),
    (m) => m.frames.pop(),
    (m) => (m.frames[0][0].amplitude = Infinity),
    (m) => (m.frames[0][0].frequency = 123.456),
    (m) => m.frames[0].push(m.frames[0][0]),
    (m) => (m.sampleRate = 44100),
  ]) {
    const bad = structuredClone(p);
    corrupt(bad.tracks[0].reconstruction);
    assert.throws(
      () => parseProject(JSON.stringify(bad)),
      /recorded instrument/,
    );
  }
  delete p.tracks[0].reconstruction;
  assert.throws(() => parseProject(JSON.stringify(p)), /recorded instrument/);
});
test("silence and unusable captures give actionable errors", () => {
  assert.throws(() => analyzeSound(new Float32Array(2400)), /No sound/);
  assert.throws(() => analyzeSound(new Float32Array(20)), /between/);
  assert.throws(() => analyzeSound(new Float32Array(120001)), /between/);
  assert.match(
    microphoneError(new DOMException("no", "NotAllowedError")),
    /Allow microphone/,
  );
  assert.match(
    microphoneError(new DOMException("no", "NotFoundError")),
    /No microphone/,
  );
});
test("microphone worklet downmixes without monitoring and stops at five seconds", () => {
  let Processor;
  const messages = [];
  class Base {
    port = { postMessage: (m) => messages.push(m) };
  }
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../public/audio/microphone.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: Base,
      sampleRate: 48000,
      Float32Array,
      registerProcessor: (_, p) => (Processor = p),
    },
  );
  const processor = new Processor();
  for (let i = 0; i < 2000; i++)
    processor.process([
      [new Float32Array(128).fill(0.2), new Float32Array(128).fill(0.6)],
    ]);
  assert.equal(messages.filter((m) => m.done).length, 1);
  assert.equal(
    messages.filter((m) => m.samples).reduce((n, m) => n + m.samples.length, 0),
    240000,
  );
  assert.ok(Math.abs(messages[0].samples[0] - 0.4) < 1e-6);
  processor.port.onmessage({ data: "stop" });
  assert.equal(messages.filter((m) => m.done).length, 1);
  const manual = new Processor();
  manual.process([[new Float32Array(128).fill(0.2)]]);
  const before = messages.length;
  manual.port.onmessage({ data: "stop" });
  manual.process([[new Float32Array(128)]]);
  assert.equal(messages.length, before + 1);
  assert.equal(messages.at(-1).done, true);
});
test("leaving while microphone permission is pending releases a late stream", async () => {
  let resolvePermission,
    stopped = false,
    closed = false;
  const oldContext = globalThis.AudioContext;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.AudioContext = class {
    async resume() {}
    async close() {
      closed = true;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => (resolvePermission = resolve)),
      },
    },
  });
  try {
    const recording = new MicrophoneRecording();
    const pending = recording.start();
    await Promise.resolve();
    recording.dispose();
    resolvePermission({
      getTracks: () => [
        {
          stop() {
            stopped = true;
          },
        },
      ],
    });
    await pending;
    assert.ok(stopped && closed);
  } finally {
    globalThis.AudioContext = oldContext;
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  }
});
