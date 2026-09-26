import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { initialProject, parseProject } from "../lib/session.ts";
import { AudioEngine } from "../lib/audio.ts";
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
  Q = new Param();
  delayTime = new Param();
  threshold = new Param();
  ratio = new Param();
  knee = new Param();
  attack = new Param();
  release = new Param();
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
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
    return new Node();
  }
  createBuffer(c, n) {
    return { getChannelData: () => new Float32Array(n) };
  }
  async resume() {}
  async close() {}
}
globalThis.AudioContext = Context;
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
