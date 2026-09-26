import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { initialProject, parseProject } from "../lib/session.ts";
import { AudioEngine } from "../lib/audio.ts";
import { analyzeSound, SAMPLE_RATE } from "../lib/resynthesis.ts";
import { Mp3Encoder } from "../public/audio/lamejs.js";
test("JSON preserves synthesis, patterns, and mixer settings without audio data", () => {
  const original = initialProject();
  const restored = parseProject(JSON.stringify(original));
  assert.deepEqual(restored, original);
  assert.ok(JSON.stringify(original).length < 12000);
  for (const corrupt of [
    (p) => (p.bpm = 0),
    (p) => (p.tracks[0].frequency = Infinity),
    (p) => (p.tracks[0].clips[0].notes = [0]),
    (p) => (p.tracks[0].active = 3),
    (p) => (p.tracks[0].id = p.tracks[1].id),
  ]) {
    const p = structuredClone(original);
    corrupt(p);
    assert.throws(() => parseProject(JSON.stringify(p)));
  }
});
class Param {
  value = 0;
  setTargetAtTime(v) {
    this.value = v;
  }
  setValueAtTime(v) {
    this.value = v;
  }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  pan = new Param();
  frequency = new Param();
  playbackRate = new Param();
  Q = new Param();
  delayTime = new Param();
  threshold = new Param();
  ratio = new Param();
  knee = new Param();
  attack = new Param();
  release = new Param();
  getFloatTimeDomainData(data) {
    data.fill(this.level ?? 0);
  }
  connect() {}
  disconnect() {}
  start(time) {
    this.started = time;
  }
  stop(time) {
    this.stopped = time;
  }
}
class Context {
  currentTime = 0;
  sampleRate = 8000;
  destination = new Node();
  createGain() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createAnalyser() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createDelay() {
    return new Node();
  }
  createConvolver() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  createBufferSource() {
    const node = new Node();
    this.bufferSources ??= [];
    this.bufferSources.push(node);
    return node;
  }
  createBuffer(c, n) {
    return { getChannelData: () => new Float32Array(n) };
  }
  async resume() {}
  async close() {}
}
globalThis.AudioContext = Context;
test("automatic previews are suppressed during playback and a pending resume cannot race transport", async () => {
  const p = initialProject(),
    e = new AudioEngine(p);
  let heard = 0;
  e.note = () => heard++;
  e.playing = true;
  await e.preview(p.tracks[0], 0, true);
  assert.equal(heard, 0);
  e.playing = false;
  let resumed;
  e.ctx.resume = () =>
    new Promise((resolve) => {
      resumed = resolve;
    });
  const pending = e.preview(p.tracks[0], 0, true);
  e.playing = true;
  resumed();
  await pending;
  assert.equal(heard, 0);
  e.playing = false;
  e.ctx.resume = async () => {};
  await e.preview(p.tracks[0], 0, true);
  assert.equal(heard, 1);
});
test("stopped sound previews include mixer and effects on a separate output bus", async () => {
  const p = initialProject(),
    e = new AudioEngine(p);
  const t = {
    ...p.tracks[2],
    reverb: 0.8,
    echo: 0.5,
    pan: -0.4,
    volume: 0.6,
    mute: true,
  };
  await e.preview(t, 0, true);
  assert.ok(e.previewBus);
  assert.equal(e.previewBus.wet.gain.value, 0.48);
  assert.equal(e.previewBus.echo.gain.value, 0.5);
  assert.equal(e.previewBus.pan.pan.value, -0.4);
  assert.equal(e.previewBus.gain.gain.value, 0.6);
  assert.notEqual(e.previewBus.input, e.channels.get(t.id).input);
  e.stop();
  assert.equal(e.previewBus, undefined);
});
test("reconstructed instruments play from spectral data, transpose, obey note lengths and stop", () => {
  const p = initialProject(),
    t = p.tracks[2];
  t.kind = "recorded";
  t.reconstruction = analyzeSound(
    Float32Array.from(
      { length: SAMPLE_RATE },
      (_, i) => 0.2 * Math.sin((i * 2 * Math.PI * 440) / SAMPLE_RATE),
    ),
  );
  t.frequency = t.reconstruction.referenceFrequency;
  const e = new AudioEngine(p);
  assert.ok(e.reconstructedBuffers.has(t.reconstruction));
  e.note(t, 12, 0, 0.125);
  const normal = e.ctx.bufferSources.at(-1);
  assert.equal(normal.playbackRate.value, 2);
  assert.equal(normal.buffer, e.reconstructedBuffers.get(t.reconstruction));
  assert.ok(normal.stopped <= 0.51);
  e.note(t, 0, 0, 0.1, true);
  const preview = e.ctx.bufferSources.at(-1);
  assert.equal(preview.stopped, 1.01);
  assert.equal(e.voices.size, 2);
  e.stop();
  assert.equal(normal.stopped, 0.025);
  assert.equal(preview.stopped, 0.025);
});
test("clip launches align at bar boundaries and every instrument shares one clock", () => {
  const p = initialProject();
  const e = new AudioEngine(p);
  let launches = [],
    events = [];
  e.onLaunch = (id, clip) => launches.push([id, clip, e.step]);
  e.note = (t, n, time) => events.push({ id: t.id, time });
  e.playing = true;
  e.queue(p.tracks[0].id, 1);
  e.queue(p.tracks[2].id, 1);
  e.tick();
  assert.equal(launches.length, 2);
  assert.ok(launches.every((l) => l[2] === 0));
  assert.ok(events.every((n) => n.time === 0));
  e.queue(p.tracks[0].id, -1);
  for (let i = 1; i < 16; i++) {
    e.ctx.currentTime = i * 0.125;
    e.tick();
  }
  assert.equal(launches.length, 2);
  e.ctx.currentTime = 2;
  e.tick();
  assert.equal(launches[2][2], 16);
  assert.equal(launches[2][1], -1);
  e.stop();
  assert.equal(e.pending.size, 0);
});
test("mutes and solo apply to the whole channel including effects", () => {
  const p = initialProject();
  const e = new AudioEngine(p);
  p.tracks[2].solo = true;
  e.update(p);
  assert.equal(e.channels.get(p.tracks[0].id).gain.gain.value, 0);
  assert.equal(
    e.channels.get(p.tracks[2].id).gain.gain.value,
    p.tracks[2].volume,
  );
  p.tracks[2].mute = true;
  e.update(p);
  assert.equal(e.channels.get(p.tracks[2].id).gain.gain.value, 0);
});
test("recording worklet captures only while armed and acknowledges stop after audio", () => {
  let Processor;
  const messages = [];
  class Base {
    port = { postMessage: (m) => messages.push(m) };
  }
  vm.runInNewContext(
    fs.readFileSync(
      new URL("../public/audio/recorder.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: Base,
      registerProcessor: (_, p) => (Processor = p),
      Float32Array,
    },
  );
  const r = new Processor();
  const sample = new Float32Array([0.2, -0.3]);
  r.process([[sample]]);
  assert.equal(messages.length, 0);
  r.port.onmessage({ data: "start" });
  r.process([[sample]]);
  assert.deepEqual(messages[0].left, sample);
  r.port.onmessage({ data: "stop" });
  r.process([[sample]]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].done, true);
});
test("MP3 encoder accepts worklet-sized stereo blocks and generates valid MPEG frames", () => {
  const e = new Mp3Encoder(2, 48000, 192);
  const parts = [];
  for (let offset = 0; offset < 48000; offset += 128) {
    const a = Int16Array.from(
      { length: Math.min(128, 48000 - offset) },
      (_, i) => Math.sin(((i + offset) * 2 * Math.PI * 220) / 48000) * 8000,
    );
    const part = e.encodeBuffer(a, a);
    if (part.length) parts.push(Buffer.from(part));
  }
  parts.push(Buffer.from(e.flush()));
  const data = Buffer.concat(parts);
  assert.ok(data.length > 20000 && data.length < 30000);
  assert.equal(data[0], 255);
  assert.equal(data[1] & 224, 224);
  fs.writeFileSync("/tmp/daw-encoding-test.mp3", data);
});

test("note gate lengths are passed to every polyphonic voice in seconds", () => {
  const p = initialProject();
  p.bpm = 120;
  p.tracks = p.tracks.slice(0, 1);
  p.tracks[0].active = 0;
  p.tracks[0].clips[0] = {
    notes: [
      { id: "a", start: 0, pitch: 0, length: 4 },
      { id: "b", start: 0, pitch: 7, length: 8 },
    ],
  };
  const e = new AudioEngine(p);
  const notes = [];
  e.note = (t, pitch, time, gate) => notes.push({ pitch, time, gate });
  e.playing = true;
  e.tick();
  assert.deepEqual(notes, [
    { pitch: 0, time: 0, gate: 0.5 },
    { pitch: 7, time: 0, gate: 1 },
  ]);
});
test("long notes sustain longer while preview remains audible on a muted track", async () => {
  const p = initialProject(),
    e = new AudioEngine(p),
    oscillators = [];
  e.ctx.createOscillator = () => {
    const n = new Node();
    n.stop = (time) => (n.end = time);
    oscillators.push(n);
    return n;
  };
  const t = { ...p.tracks[2], mute: true };
  e.note(t, 0, 0, 0.125);
  e.note(t, 0, 0, 1);
  assert.ok(Math.abs(oscillators[1].end - oscillators[0].end - 0.875) < 1e-9);
  let seen;
  e.note = (...args) => (seen = args);
  await e.preview(t, 12);
  assert.equal(seen[1], 12);
  assert.equal(seen[4], true);
});

test("recording arms without starting clips; Stop cuts voices but keeps recording and effects routing", async () => {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {}
  };
  try {
    const p = initialProject(),
      e = new AudioEngine(p),
      messages = [];
    e.recorder = { port: { postMessage: (m) => messages.push(m) } };
    await e.record();
    assert.equal(e.playing, false);
    assert.equal(e.recording, true);
    assert.ok(e.project.tracks.every((t) => t.active === -1));
    let stopped = 0;
    e.voices.add(() => stopped++);
    e.playing = true;
    e.stop();
    assert.equal(stopped, 1);
    assert.equal(e.recording, true);
    assert.equal(e.master.gain.value, p.master);
    assert.equal(
      e.channels.get(p.tracks[0].id).gain.gain.value,
      p.tracks[0].volume,
    );
    assert.deepEqual(messages, ["start"]);
    e.endRecording();
  } finally {
    globalThis.Worker = NativeWorker;
  }
});
test("finishing a take completes the current bar and waits for every channel tail", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const p = initialProject();
  p.tracks[0].active = 0;
  const e = new AudioEngine(p),
    messages = [];
  e.recorder = { port: { postMessage: (m) => messages.push(m) } };
  e.recording = true;
  e.playing = true;
  e.step = 6;
  e.next = 0.75;
  e.ctx.currentTime = 0.75;
  e.lastVoiceEnd = 2.4;
  const steps = [];
  e.note = () => {};
  e.onStep = (s) => steps.push(s);
  let finalized = 0;
  e.onRecordingFinalizing = () => finalized++;
  e.finishRecording();
  assert.equal(e.stopAtStep, 16);
  assert.equal(e.recording, true);
  for (let i = 6; i <= 16; i++) {
    e.ctx.currentTime = i * 0.125;
    e.tick();
  }
  assert.equal(e.playing, false);
  assert.deepEqual(steps, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(e.recording, true);
  const channel = e.channels.values().next().value;
  channel.analyser.level = 0.02;
  e.ctx.currentTime = 2.5;
  t.mock.timers.tick(50);
  assert.equal(finalized, 0);
  channel.analyser.level = 0;
  e.ctx.currentTime = 3;
  t.mock.timers.tick(50);
  e.ctx.currentTime = 4.9;
  t.mock.timers.tick(50);
  assert.equal(finalized, 0);
  channel.analyser.level = 0.0002;
  e.ctx.currentTime = 5;
  t.mock.timers.tick(50);
  channel.analyser.level = 0;
  e.ctx.currentTime = 5.1;
  t.mock.timers.tick(50);
  e.ctx.currentTime = 7.2;
  t.mock.timers.tick(50);
  assert.equal(finalized, 1);
  assert.equal(e.recording, false);
  assert.equal(e.finishing, false);
  assert.deepEqual(messages, ["stop"]);
  assert.equal(e.tailTimer, null);
});
