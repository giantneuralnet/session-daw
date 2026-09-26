import test from "node:test";
import assert from "node:assert/strict";
import { computeFFT, runFFT, cachedConstruction } from "../lib/fft-job.ts";
import {
  moveWindow,
  selectedSound,
  waveformPeaks,
  MIN_WINDOW,
} from "../lib/sound-window.ts";
import { SAMPLE_RATE } from "../lib/resynthesis.ts";

const recording = Float32Array.from(
  { length: SAMPLE_RATE },
  (_, i) =>
    0.4 *
    Math.sin(
      (i * 2 * Math.PI * (i < SAMPLE_RATE / 2 ? 220 : 880)) / SAMPLE_RATE,
    ),
);
test("construction reuses cached audio only for the same source, selection, count and shape", async () => {
  const source = new Float32Array(recording);
  let builds = 0;
  const build = async () => {
    builds++;
    return computeFFT({ samples: source, count: 8 });
  };
  const first = await cachedConstruction(source, "0:24000:8:sine", build);
  assert.equal(
    await cachedConstruction(source, "0:24000:8:sine", build),
    first,
  );
  assert.equal(builds, 1);
  for (const key of [
    "0:24000:16:sine",
    "0:24000:8:triangle",
    "1200:24000:8:sine",
  ])
    await cachedConstruction(source, key, build);
  assert.equal(builds, 4);
  await cachedConstruction(new Float32Array(source), "0:24000:8:sine", build);
  assert.equal(builds, 5);
});
test("FFT analyzes only the selected window without silently trimming it", () => {
  const capture = {
    samples: recording,
    window: [SAMPLE_RATE / 2, SAMPLE_RATE],
  };
  const selected = selectedSound(capture);
  assert.equal(selected.length, SAMPLE_RATE / 2);
  const { model, samples } = computeFFT({ samples: selected, count: 32 });
  assert.equal(model.length, SAMPLE_RATE / 2);
  assert.equal(samples.length, selected.length);
  assert.equal(model.count, 32);
  assert.ok(Math.abs(model.referenceFrequency - 880) < 6);
  assert.equal(recording.length, SAMPLE_RATE);
  selected[0] = 123;
  assert.notEqual(recording[SAMPLE_RATE / 2], 123);
});
test("start and end handles cannot cross, go outside the take, or create an unusable slice", () => {
  assert.deepEqual(moveWindow([0, 24000], 0, -500, 24000), [0, 24000]);
  assert.deepEqual(moveWindow([0, 24000], 0, 40000, 24000), [
    24000 - MIN_WINDOW,
    24000,
  ]);
  assert.deepEqual(moveWindow([0, 24000], 1, 0, 24000), [0, MIN_WINDOW]);
  assert.deepEqual(moveWindow([4000, 24000], 1, 25000, 24000), [4000, 24000]);
  assert.deepEqual(moveWindow([0, 24000], 0, NaN, 24000), [0, 24000]);
});
test("waveform display preserves short peaks rather than skipping transients", () => {
  const samples = new Float32Array(1000);
  samples[499] = 1;
  samples[700] = -0.7;
  const peaks = waveformPeaks(samples, 10);
  assert.equal(peaks[4][1], 1);
  assert.ok(Math.abs(peaks[7][0] + 0.7) < 1e-6);
});
test("worker startup errors fall back successfully and preserve the captured sound", async () => {
  const controller = new AbortController();
  const job = { samples: recording, count: 8 };
  const result = await runFFT(
    job,
    () => {
      throw new DOMException("Invalid URL", "SecurityError");
    },
    controller.signal,
  );
  assert.equal(result.model.count, 8);
  assert.equal(result.samples.length, recording.length);
  assert.equal(recording.length, SAMPLE_RATE);
  let terminated = 0;
  const failedWorker = {
    terminate() {
      terminated++;
    },
    postMessage() {
      queueMicrotask(() => this.onerror({ preventDefault() {} }));
    },
  };
  const recovered = await runFFT(job, () => failedWorker, controller.signal);
  assert.equal(recovered.samples.length, recording.length);
  assert.ok(terminated > 0);
});
test("worker results use the same reconstruction and cancellation prevents late work", async () => {
  const job = { samples: recording, count: 32 };
  const worker = {
    terminate() {},
    postMessage(data) {
      queueMicrotask(() => this.onmessage({ data: computeFFT(data) }));
    },
  };
  const result = await runFFT(job, () => worker, new AbortController().signal);
  assert.equal(result.model.count, 32);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runFFT(
      job,
      () => {
        throw Error("Should not run");
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  await assert.rejects(
    runFFT(
      { samples: new Float32Array(2400), count: 32 },
      () => {
        throw Error("No worker");
      },
      new AbortController().signal,
    ),
    /No sound detected/,
  );
});
