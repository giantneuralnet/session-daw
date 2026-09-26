import { MIN_PITCH, MAX_PITCH, type Note } from "./session.ts";
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function drawNote(
  id: string,
  anchor: number,
  end: number,
  pitch: number,
): Note {
  const start = clamp(Math.min(anchor, end), 0, 15);
  return {
    id,
    start,
    pitch: clamp(pitch, MIN_PITCH, MAX_PITCH),
    length: clamp(Math.abs(end - anchor) + 1, 1, 16 - start),
  };
}
export function moveNote(note: Note, steps: number, rows: number): Note {
  return {
    ...note,
    start: clamp(note.start + steps, 0, 16 - note.length),
    pitch: clamp(note.pitch + rows, MIN_PITCH, MAX_PITCH),
  };
}
export function resizeNote(note: Note, end: number): Note {
  return { ...note, length: clamp(end - note.start + 1, 1, 16 - note.start) };
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
  mode: "empty" | "move" | "resize",
  original: Note,
  draft: Note,
  moved: boolean,
): { notes: Note[]; preview: number | null } {
  if (mode === "empty")
    return moved
      ? { notes, preview: null }
      : { notes: placeNote(notes, original), preview: original.pitch };
  if (mode === "move" && !moved)
    return { notes: notes.filter((n) => n.id !== original.id), preview: null };
  return { notes: placeNote(notes, draft), preview: null };
}
