import type { Note } from "./session";
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
    pitch: clamp(pitch, 0, 24),
    length: clamp(Math.abs(end - anchor) + 1, 1, 16 - start),
  };
}
export function moveNote(note: Note, steps: number, rows: number): Note {
  return {
    ...note,
    start: clamp(note.start + steps, 0, 16 - note.length),
    pitch: clamp(note.pitch + rows, 0, 24),
  };
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
