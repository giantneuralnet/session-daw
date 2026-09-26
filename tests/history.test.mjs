import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../lib/history.ts";
import { emptyProject, addRow, parseProject } from "../lib/session.ts";
import {
  drawNote,
  resizeNote,
  finishGesture,
  pasteNotes,
} from "../lib/piano-roll.ts";
test("global history restores notes, settings, structure, and fresh projects", () => {
  const h = new History();
  let p = emptyProject();
  const original = p;
  const change = (fn) => {
    const n = fn(p);
    h.commit(p, n);
    p = n;
  };
  change((p) => ({ ...p, bpm: 135 }));
  change(addRow);
  change((p) => ({
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: [{ notes: [drawNote("n", 1, 4, -12)] }, ...t.clips.slice(1)],
    })),
  }));
  const edited = p;
  change(() => emptyProject());
  assert.deepEqual(h.undo(p), edited);
  p = h.undo(edited);
  assert.equal(p.tracks[0].clips[0].notes.length, 0);
  p = h.undo(p);
  assert.equal(p.tracks[0].clips.length, 4);
  p = h.undo(p);
  assert.deepEqual(p, original);
  assert.equal(h.canUndo, false);
  p = h.redo(p);
  assert.equal(p.bpm, 135);
  p = h.redo(p);
  assert.equal(p.tracks[0].clips.length, 5);
  p = h.redo(p);
  assert.deepEqual(p, edited);
});
test("a slider gesture is one undo step and an edit after undo clears redo", () => {
  const h = new History();
  h.begin();
  h.commit({ volume: 0 }, { volume: 0.1 });
  h.commit({ volume: 0.1 }, { volume: 0.5 });
  h.commit({ volume: 0.5 }, { volume: 0.8 });
  h.end();
  assert.deepEqual(h.undo({ volume: 0.8 }), { volume: 0 });
  assert.equal(h.canUndo, false);
  assert.deepEqual(h.redo({ volume: 0 }), { volume: 0.8 });
  h.undo({ volume: 0.8 });
  assert.equal(h.commit({ volume: 0 }, { volume: 0 }), false);
  assert.equal(h.canRedo, true);
  h.commit({ volume: 0 }, { volume: 0.2 });
  assert.equal(h.canRedo, false);
});
test("scrolling and cancelled movement do not create notes, taps do, deletion stays silent", () => {
  const n = drawNote("n", 3, 3, 7);
  const blank = [];
  assert.deepEqual(finishGesture(blank, "empty", n, n, false), {
    notes: [n],
    preview: 7,
  });
  assert.deepEqual(finishGesture(blank, "empty", n, n, true), {
    notes: blank,
    preview: null,
  });
  assert.deepEqual(finishGesture([n], "move", n, n, false), {
    notes: [],
    preview: null,
  });
  assert.deepEqual(finishGesture([n], "move", n, { ...n, pitch: 10 }, true), {
    notes: [{ ...n, pitch: 10 }],
    preview: null,
  });
});
test("resize preserves pitch and start and clamps to bar boundaries", () => {
  const n = drawNote("n", 12, 12, -24);
  assert.deepEqual(resizeNote(n, 30), { ...n, length: 4 });
  assert.deepEqual(resizeNote(n, 0), { ...n, length: 1 });
});
test("copy-paste creates independent note IDs, preserves extended pitches, and is undoable", () => {
  const notes = [drawNote("a", 0, 3, -36), drawNote("b", 8, 15, 60)];
  let count = 0;
  const pasted = pasteNotes(notes, () => `paste-${++count}`);
  assert.equal(pasted[0].id, "paste-1");
  assert.deepEqual(
    pasted.map(({ id, ...n }) => n),
    notes.map(({ id, ...n }) => n),
  );
  pasted[0].length = 2;
  assert.equal(notes[0].length, 4);
  const p = emptyProject();
  p.tracks[0].clips[0] = { notes: pasted };
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  const h = new History();
  h.commit([], pasted);
  assert.deepEqual(h.undo(pasted), []);
  assert.deepEqual(h.redo([]), pasted);
});
test("history bounds memory and ignores identical edits", () => {
  const h = new History(2);
  h.commit(0, 1);
  h.commit(1, 2);
  h.commit(2, 3);
  assert.equal(h.undo(3), 2);
  assert.equal(h.undo(2), 1);
  assert.equal(h.undo(1), null);
});
