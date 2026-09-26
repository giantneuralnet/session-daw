import { MIN_PITCH, MAX_PITCH, type Note } from "./session.ts";
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const NOTE_HOLD_MS = 1000 / 3;
export function noteDragMode(elapsed: number, side: "left" | "right") {
  return elapsed < NOTE_HOLD_MS
    ? "move"
    : side === "left"
      ? "resize-start"
      : "resize";
}
export function drawNote(
  id: string,
  anchor: number,
  end: number,
  pitch: number,
  steps = 16,
): Note {
  const start = clamp(Math.min(anchor, end), 0, steps - 1);
  return {
    id,
    start,
    pitch: clamp(pitch, MIN_PITCH, MAX_PITCH),
    length: clamp(Math.abs(end - anchor) + 1, 1, steps - start),
  };
}
export function moveNote(
  note: Note,
  steps: number,
  rows: number,
  barSteps = 16,
): Note {
  return {
    ...note,
    start: clamp(
      note.start + steps,
      0,
      barSteps - Math.min(note.length, barSteps),
    ),
    length: Math.min(note.length, barSteps),
    pitch: clamp(note.pitch + rows, MIN_PITCH, MAX_PITCH),
  };
}
export function resizeNote(note: Note, end: number, steps = 16): Note {
  return {
    ...note,
    length: clamp(end - note.start + 1, 1, steps - note.start),
  };
}
export function resizeNoteStart(note: Note, start: number, steps = 16): Note {
  const end = Math.min(note.start + note.length, steps);
  const next = clamp(start, 0, end - 1);
  return { ...note, start: next, length: end - next };
}
export function centeredPitch(notes: Note[], steps = 16) {
  const visible = notes.filter((n) => n.start < steps);
  return visible.length
    ? (Math.min(...visible.map((n) => n.pitch)) +
        Math.max(...visible.map((n) => n.pitch))) /
        2
    : 0;
}
export function placeNote(notes: Note[], note: Note): Note[] {
  return [
    ...notes.filter(
      (n) =>
        n.id !== note.id &&
        !(
          n.pitch === note.pitch &&
          n.start < note.start + note.length &&
          n.start + n.length > note.start
        ),
    ),
    note,
  ];
}
export function pasteNotes(
  notes: Note[],
  id = () => crypto.randomUUID(),
): Note[] {
  return notes.map((n) => ({ ...n, id: id() }));
}
export function finishGesture(
  notes: Note[],
  mode: "empty" | "move" | "resize" | "resize-start",
  original: Note,
  draft: Note,
  moved: boolean,
  held = false,
): { notes: Note[]; preview: number | null } {
  if (mode === "empty")
    return moved
      ? { notes, preview: null }
      : { notes: placeNote(notes, original), preview: original.pitch };
  if (!moved && held) return { notes, preview: null };
  if (!moved)
    return { notes: notes.filter((n) => n.id !== original.id), preview: null };
  return { notes: placeNote(notes, draft), preview: null };
}
