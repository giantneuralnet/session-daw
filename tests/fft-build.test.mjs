import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("published FFT worker uses a web asset URL and executes the capture-to-reconstruction job", () => {
  const directory = new URL("../dist/client/_next/static/", import.meta.url);
  const workerFile = fs
    .readdirSync(directory)
    .find((name) => /^resynthesis\.worker-.*\.js$/.test(name));
  assert.ok(workerFile, "FFT worker is included in deployment assets");
  const chunks = new URL("chunks/", directory);
  const client = fs
    .readdirSync(chunks)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(new URL(name, chunks), "utf8"))
    .join("\n");
  assert.ok(client.includes(`/_next/static/${workerFile}`));
  // Regression: vinext replaced import.meta.url with file:///ROOT, causing the
  // previous new Worker(new URL(..., import.meta.url)) to fail in production.
  assert.doesNotMatch(
    client,
    /new URL\([^)]*resynthesis\.worker[^)]*file:\/\//,
  );
  assert.doesNotMatch(client, /file:\/\/[^`"']*resynthesis\.worker/);
  const messages = [];
  const self = { postMessage: (data) => messages.push(data) };
  vm.runInNewContext(fs.readFileSync(new URL(workerFile, directory), "utf8"), {
    self,
    Float32Array,
    Float64Array,
  });
  const samples = Float32Array.from(
    { length: 6000 },
    (_, i) => 0.25 * Math.sin((i * 2 * Math.PI * 440) / 24000),
  );
  self.onmessage({ data: { samples, count: 16 } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, undefined);
  assert.equal(messages[0].model.count, 16);
  assert.equal(messages[0].samples.length, samples.length);
  assert.ok(messages[0].samples.some((value) => Math.abs(value) > 0.1));
});
