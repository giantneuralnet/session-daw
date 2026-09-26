import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  LocalRecovery,
  packRecovery,
  parseRecovery,
  restoreCaptures,
  browserArchive,
  RECOVERY_KEY,
} from "../lib/recovery.ts";
import { initialProject } from "../lib/session.ts";
import { analyzeSound, SAMPLE_RATE } from "../lib/resynthesis.ts";

const view = { selected: "track-2", clipIndex: 1, tab: "sound" };
const local = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
function fixture() {
  const project = initialProject();
  const captures = new Map();
  for (const [index, frequency] of [
    [0, 220],
    [2, 880],
  ]) {
    const samples = Float32Array.from(
      { length: 2400 },
      (_, i) => 0.2 * Math.sin((i * 2 * Math.PI * frequency) / SAMPLE_RATE),
    );
    project.tracks[index].reconstruction = analyzeSound(samples);
    project.tracks[index].kind = "recorded";
    captures.set(project.tracks[index].id, {
      samples,
      window: [0, samples.length],
      appliedWindow: [0, samples.length],
      appliedModel: project.tracks[index].reconstruction,
      count: 8,
      wave: "square",
    });
  }
  return { project, captures };
}
test("recovery restores each instrument's original audio and draft settings independently", async () => {
  const { project, captures } = fixture();
  project.tracks[0].active = 0;
  const storage = local(),
    recovery = new LocalRecovery(storage);
  const archive = packRecovery(project, view, captures);
  assert.ok(!archive.json.includes('"samples"'));
  assert.equal(await recovery.save(archive), true);
  assert.equal(storage.getItem(RECOVERY_KEY), archive.json);
  const restored = await new LocalRecovery(storage).restore();
  assert.equal(restored.recovery.selected, "track-2");
  assert.equal(restored.recovery.clipIndex, 1);
  assert.ok(restored.recovery.project.tracks.every((t) => t.active === -1));
  assert.equal(restored.captures.size, 2);
  for (const [id, capture] of captures) {
    assert.deepEqual(restored.captures.get(id).samples, capture.samples);
    assert.equal(restored.captures.get(id).wave, "square");
    assert.equal(restored.captures.get(id).count, 8);
    assert.equal(
      restored.captures.get(id).appliedModel,
      restored.recovery.project.tracks.find((t) => t.id === id).reconstruction,
    );
  }
  assert.notDeepEqual(
    restored.captures.get("track-0").samples,
    restored.captures.get("track-2").samples,
  );
});
test("large JSON falls back to the browser archive when localStorage is full", async () => {
  const { project, captures } = fixture();
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  const recovery = new LocalRecovery(storage);
  assert.equal(
    await recovery.save(packRecovery(project, view, captures)),
    true,
  );
  const restored = await recovery.restore();
  assert.equal(restored.captures.size, 2);
});
test("newer JSON wins over the previous audio checkpoint without restoring stale recordings", async () => {
  const { project, captures } = fixture();
  const earlier = packRecovery(project, view, captures, 1);
  const latest = packRecovery({ ...project, bpm: 170 }, view, new Map(), 2);
  const storage = local();
  storage.setItem(RECOVERY_KEY, latest.json);
  const recovery = new LocalRecovery(storage, {
    read: async () => earlier,
    write: async () => {},
  });
  const restored = await recovery.restore();
  assert.equal(restored.recovery.project.bpm, 170);
  assert.equal(restored.captures.size, 0);
});
test("autosaves are serialized and failures do not erase the last valid archive", async () => {
  const { project } = fixture(),
    storage = local();
  let resolveFirst, current;
  const archive = {
    read: async () => current,
    write: async (value) => {
      if (parseRecovery(value.json).project.bpm === 120)
        await new Promise((resolve) => {
          resolveFirst = resolve;
        });
      current = value;
    },
  };
  const recovery = new LocalRecovery(storage, archive);
  const first = recovery.save(packRecovery(project, view, new Map(), 1));
  const second = recovery.save(
    packRecovery({ ...project, bpm: 130 }, view, new Map(), 2),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveFirst();
  await Promise.all([first, second]);
  assert.equal(parseRecovery(current.json).project.bpm, 130);
  const failed = new LocalRecovery(
    {
      getItem() {
        return null;
      },
      setItem() {
        throw Error();
      },
    },
    {
      read: async () => null,
      write: async () => {
        throw Error();
      },
    },
  );
  assert.equal(await failed.save(current), false);
});
test("corrupt JSON falls back safely and malformed sample ranges are rejected", async () => {
  const { project, captures } = fixture(),
    storage = local();
  const archive = packRecovery(project, view, captures);
  storage.setItem(RECOVERY_KEY, "broken");
  const recovery = new LocalRecovery(storage, {
    read: async () => archive,
    write: async () => {},
  });
  assert.equal((await recovery.restore()).captures.size, 2);
  archive.captures[0].window = [-1, 200];
  assert.equal(
    restoreCaptures(parseRecovery(archive.json), archive.captures).size,
    1,
  );
});
