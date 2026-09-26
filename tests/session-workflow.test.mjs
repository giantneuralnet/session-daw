import test from "node:test";
import assert from "node:assert/strict";
import {
  initialProject,
  ensureEmptyRow,
  parseProject,
} from "../lib/session.ts";
import { soundPresets } from "../lib/presets.ts";
import { TailMonitor } from "../lib/tail-monitor.ts";
test("filling any column adds one aligned empty row, without adding rows on other edits", () => {
  const p = initialProject();
  assert.equal(ensureEmptyRow(p), p);
  p.tracks[0].clips = p.tracks[0].clips.map((c) => c ?? { notes: [] });
  const expanded = ensureEmptyRow(p);
  assert.ok(
    expanded.tracks.every((t) => t.clips.length === 5 && t.clips[4] === null),
  );
  assert.equal(ensureEmptyRow(expanded), expanded);
  assert.deepEqual(parseProject(JSON.stringify(expanded)), expanded);
});
test("all drum and synth presets save as valid synthesis descriptions", () => {
  assert.ok(soundPresets.some((p) => p.group === "Drums"));
  assert.ok(soundPresets.some((p) => p.group === "Synths"));
  for (const preset of soundPresets) {
    const p = initialProject();
    p.tracks[0] = { ...p.tracks[0], ...preset.sound };
    assert.deepEqual(parseProject(JSON.stringify(p)), p);
  }
});
test("tail detection cannot finish during silence between beats or echo repeats", () => {
  const m = new TailMonitor();
  assert.equal(m.update(0, 0, false), false);
  assert.equal(m.update(10, 0, false), false);
  assert.equal(m.update(11, 0, true), false);
  assert.equal(m.update(12.1, 0.002, true), false);
  assert.equal(m.update(12.2, 0, true), false);
  assert.equal(m.update(14.1, 0, true), false);
  assert.equal(m.update(14.3, 0, true), true);
});
