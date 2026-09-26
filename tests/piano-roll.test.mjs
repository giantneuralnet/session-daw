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
  assert.deepEqual(moveNote(n, 20, 100), {
    id: "a",
    start: 12,
    length: 4,
    pitch: 60,
  });
  assert.deepEqual(moveNote(n, -20, -100), {
    id: "a",
    start: 0,
    length: 4,
    pitch: -36,
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
    (p) => (p.tracks[0].clips[0].notes[0].length = 129),
    (p) => (p.tracks[0].clips[0].notes[0].pitch = 61),
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

test("meter-aware editing resizes either edge and centers the visible pitch range", async () => {
  const { resizeNote, resizeNoteStart, centeredPitch, finishGesture } =
    await import("../lib/piano-roll.ts");
  const n = { id: "n", start: 4, length: 4, pitch: 7 };
  assert.deepEqual(resizeNoteStart(n, 2, 12), { ...n, start: 2, length: 6 });
  assert.deepEqual(resizeNoteStart(n, 10, 12), { ...n, start: 7, length: 1 });
  assert.deepEqual(resizeNoteStart(n, -4, 12), { ...n, start: 0, length: 8 });
  assert.equal(resizeNote(n, 30, 12).length, 8);
  assert.equal(drawNote("end", 30, 30, 0, 32).start, 30);
  assert.equal(moveNote(n, 30, 0, 12).start, 8);
  const notes = [
    { ...n, pitch: -12 },
    { ...n, id: "high", pitch: 24 },
    { ...n, id: "outside", start: 14, pitch: 60 },
  ];
  assert.equal(centeredPitch(notes, 12), 6);
  assert.equal(centeredPitch([], 12), 0);
  assert.deepEqual(finishGesture([n], "resize-start", n, n, false), {
    notes: [],
    preview: null,
  });
});

test("time signatures round-trip and shorter bars preserve notes for later expansion", async () => {
  const { stepsPerBar } = await import("../lib/session.ts");
  const p = initialProject();
  const original = structuredClone(p.tracks);
  for (const [signature, steps] of [
    [[3, 4], 12],
    [[6, 8], 12],
    [[7, 8], 14],
    [[5, 4], 20],
    [[16, 2], 128],
    [[1, 16], 1],
  ]) {
    p.timeSignature = signature;
    const loaded = parseProject(JSON.stringify(p));
    assert.equal(stepsPerBar(loaded), steps);
    assert.deepEqual(loaded.tracks, original);
  }
  for (const bad of [[0, 4], [3, 3], [17, 4], [4], "4/4", [4, 4, 4]]) {
    p.timeSignature = bad;
    assert.throws(() => parseProject(JSON.stringify(p)), /time signature/);
  }
  delete p.timeSignature;
  assert.equal(stepsPerBar(parseProject(JSON.stringify(p))), 16);
});

test("immediate drags move from either side, while a one-third-second hold selects the resize edge", async () => {
  const { noteDragMode, NOTE_HOLD_MS, finishGesture } =
    await import("../lib/piano-roll.ts");
  for (const side of ["left", "right"]) {
    assert.equal(noteDragMode(0, side), "move");
    assert.equal(noteDragMode(NOTE_HOLD_MS - 1, side), "move");
  }
  assert.equal(noteDragMode(NOTE_HOLD_MS, "left"), "resize-start");
  assert.equal(noteDragMode(NOTE_HOLD_MS, "right"), "resize");
  const n = { id: "a", start: 2, pitch: 7, length: 4 };
  const notes = [n];
  assert.deepEqual(
    finishGesture(notes, "move", n, n, false, true),
    { notes, preview: null },
    "releasing a held note without dragging does not erase it",
  );
  assert.deepEqual(
    finishGesture(notes, "move", n, n, false, false),
    { notes: [], preview: null },
    "a quick tap still erases silently",
  );
});
