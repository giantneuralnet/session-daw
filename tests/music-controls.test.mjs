import test from "node:test";
import assert from "node:assert/strict";
import { parseBpm, stepBpm, noteShortcuts } from "../lib/music.ts";
import { shareAudio } from "../lib/sharing.ts";
test("tempo accepts valid text and rejects empty, non-numeric, and out-of-range input", () => {
  for (const [s, n] of [
    ["120", 120],
    [" 100.5 ", 100.5],
    ["40", 40],
    ["240", 240],
  ])
    assert.equal(parseBpm(s), n);
  for (const s of ["", "abc", "39", "241", "1e2", "Infinity"])
    assert.equal(parseBpm(s), null);
});
test("tempo nudges in tens, clamps limits, and can correct out-of-range drafts", () => {
  assert.equal(stepBpm("120", 90, 10), "130");
  assert.equal(stepBpm("120", 90, -10), "110");
  assert.equal(stepBpm("45", 90, -10), "40");
  assert.equal(stepBpm("235", 90, 10), "240");
  assert.equal(stepBpm("250", 90, -10), "240");
  assert.equal(stepBpm("", 120, 10), "130");
});
test("note shortcuts map standard pitches to accurate frequencies", () => {
  assert.equal(noteShortcuts.find((n) => n.name === "A4").frequency, 440);
  assert.equal(noteShortcuts.find((n) => n.name === "C4").frequency, 261.63);
  assert.equal(noteShortcuts.find((n) => n.name === "C2").frequency, 65.41);
});
test("sharing sends an MP3 file, not a site URL", async () => {
  let received;
  const blob = new Blob(["audio bytes"], { type: "audio/mpeg" });
  const result = await shareAudio(blob, "Take.mp3", {
    canShare: (data) => data.files[0].type === "audio/mpeg",
    share: async (data) => {
      received = data;
    },
  });
  assert.equal(result, "shared");
  assert.equal(received.files[0].name, "Take.mp3");
  assert.equal(await received.files[0].text(), "audio bytes");
  assert.equal(received.url, undefined);
});
test("sharing reports unsupported files and handles cancellation without hiding real errors", async () => {
  const blob = new Blob(["audio"]);
  assert.equal(await shareAudio(blob, "take.mp3", {}), "unsupported");
  assert.equal(
    await shareAudio(blob, "take.mp3", {
      canShare: () => false,
      share: async () => assert.fail("must not share"),
    }),
    "unsupported",
  );
  assert.equal(
    await shareAudio(blob, "take.mp3", {
      canShare: () => true,
      share: async () => {
        throw new DOMException("cancelled", "AbortError");
      },
    }),
    "cancelled",
  );
  await assert.rejects(() =>
    shareAudio(blob, "take.mp3", {
      canShare: () => true,
      share: async () => {
        throw new Error("Failed");
      },
    }),
  );
});
