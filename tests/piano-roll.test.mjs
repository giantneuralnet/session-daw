import test from "node:test";
import assert from "node:assert/strict";
import { drawNote, moveNote, placeNote } from "../lib/piano-roll.ts";
import {
  initialProject,
  emptyProject,
  makeTrack,
  addRow,
  parseProject,
} from "../lib/session.ts";
test("drawing in either direction creates inclusive snapped lengths", () => {
  assert.deepEqual(drawNote("a", 2, 5, 7), {
    id: "a",
    start: 2,
    pitch: 7,
    length: 4,
  });
  assert.deepEqual(drawNote("a", 5, 2, 7), {
    id: "a",
    start: 2,
    pitch: 7,
    length: 4,
  });
  assert.equal(drawNote("a", 15, 15, 24).length, 1);
});
test("dragging preserves duration and clamps the whole note to the grid", () => {
  const n = drawNote("a", 4, 7, 12);
  assert.deepEqual(moveNote(n, 20, 20), {
    id: "a",
    start: 12,
    length: 4,
    pitch: 24,
  });
  assert.deepEqual(moveNote(n, -20, -20), {
    id: "a",
    start: 0,
    length: 4,
    pitch: 0,
  });
});
test("placing notes permits chords and replaces same-pitch overlaps", () => {
  const a = drawNote("a", 0, 3, 0),
    b = drawNote("b", 0, 3, 7),
    c = drawNote("c", 2, 5, 0);
  assert.deepEqual(placeNote([a, b], c), [b, c]);
  assert.equal(placeNote([a, b], moveNote(a, 8, 0)).length, 2);
});
test("new creates a clean session and added rows stay aligned across tracks and JSON", () => {
  let p = emptyProject();
  assert.equal(p.tracks.length, 1);
  assert.deepEqual(p.tracks[0].clips[0].notes, []);
  p = addRow(p);
  p.tracks.push(makeTrack(1, p.tracks[0].clips.length));
  p.tracks[1].clips[4] = { notes: [drawNote("a", 3, 10, 8)] };
  p.tracks[1].active = 4;
  assert.equal(p.tracks[0].clips.length, 5);
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
});
test("old JSON projects migrate rests and notes to duration-based notes", () => {
  const p = initialProject();
  p.version = 1;
  for (const t of p.tracks)
    t.clips = t.clips.map((c) =>
      c
        ? {
            name: "Legacy",
            notes: Array.from(
              { length: 16 },
              (_, i) => c.notes.find((n) => n.start === i)?.pitch ?? -1,
            ),
          }
        : null,
    );
  const migrated = parseProject(JSON.stringify(p));
  assert.equal(migrated.version, 2);
  assert.deepEqual(
    migrated.tracks[0].clips[0].notes.map(({ start, pitch, length }) => ({
      start,
      pitch,
      length,
    })),
    [0, 4, 8, 12].map((start) => ({ start, pitch: 0, length: 1 })),
  );
});
test("invalid durations, repeated note IDs and misaligned row counts are rejected", () => {
  for (const corrupt of [
    (p) => (p.tracks[0].clips[0].notes[0].length = 17),
    (p) => (p.tracks[0].clips[0].notes[0].pitch = 25),
    (p) => (p.tracks[0].clips[0].notes[0].start = -1),
    (p) => p.tracks[0].clips.push(null),
    (p) =>
      p.tracks[0].clips[0].notes.push({ ...p.tracks[0].clips[0].notes[0] }),
  ]) {
    const p = initialProject();
    corrupt(p);
    assert.throws(() => parseProject(JSON.stringify(p)));
  }
});
