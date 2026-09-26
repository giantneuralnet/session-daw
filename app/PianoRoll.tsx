"use client";
import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import type { Note } from "../lib/session";
import { clamp, drawNote, moveNote, placeNote } from "../lib/piano-roll";
type Gesture = {
  pointer: number;
  original: Note;
  anchor: number;
  pitch: number;
  x: number;
  y: number;
  mode: "draw" | "move";
  moved: boolean;
  draft: Note;
};
export function PianoRoll({
  notes,
  onChange,
  onPreview,
  frequency,
  step,
}: {
  notes: Note[];
  onChange: (notes: Note[]) => void;
  onPreview: (pitch: number) => void;
  frequency: number;
  step: number;
}) {
  const grid = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Note | null>(null),
    [cursor, setCursor] = useState({ start: 0, pitch: 12 });
  const shown = draft ? placeNote(notes, draft) : notes;
  function cell(e: PointerEvent) {
    const r = grid.current!.getBoundingClientRect();
    return {
      start: clamp(Math.floor(((e.clientX - r.left) / r.width) * 16), 0, 15),
      pitch:
        24 - clamp(Math.floor(((e.clientY - r.top) / r.height) * 25), 0, 24),
    };
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault();
    const at = cell(e),
      id = (e.target as HTMLElement).closest<HTMLElement>("[data-note]")
        ?.dataset.note,
      existing = notes.find((n) => n.id === id);
    const note =
      existing ?? drawNote(crypto.randomUUID(), at.start, at.start, at.pitch);
    gesture.current = {
      pointer: e.pointerId,
      original: note,
      anchor: at.start,
      pitch: at.pitch,
      x: e.clientX,
      y: e.clientY,
      mode: existing ? "move" : "draw",
      moved: false,
      draft: note,
    };
    grid.current!.setPointerCapture(e.pointerId);
    grid.current!.focus({ preventScroll: true });
    setDraft(note);
    setCursor(at);
    onPreview(note.pitch);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const at = cell(e);
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.moved = true;
    if (!g.moved) return;
    const next =
      g.mode === "draw"
        ? drawNote(g.original.id, g.anchor, at.start, at.pitch)
        : moveNote(g.original, at.start - g.anchor, at.pitch - g.pitch);
    if (next.pitch !== g.draft.pitch) onPreview(next.pitch);
    g.draft = next;
    setDraft(next);
    setCursor({ start: next.start, pitch: next.pitch });
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancel = false) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (!cancel)
      onChange(
        g.mode === "move" && !g.moved
          ? notes.filter((n) => n.id !== g.original.id)
          : placeNote(notes, g.draft),
      );
    gesture.current = null;
    setDraft(null);
    if (grid.current?.hasPointerCapture(e.pointerId))
      grid.current.releasePointerCapture(e.pointerId);
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (gesture.current) return;
    const hit = notes.find(
      (n) =>
        n.pitch === cursor.pitch &&
        cursor.start >= n.start &&
        cursor.start < n.start + n.length,
    );
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        "Backspace",
        "Delete",
        " ",
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (hit) onChange(notes.filter((n) => n.id !== hit.id));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (hit) onChange(notes.filter((n) => n.id !== hit.id));
      else {
        onChange(
          placeNote(
            notes,
            drawNote(
              crypto.randomUUID(),
              cursor.start,
              cursor.start,
              cursor.pitch,
            ),
          ),
        );
        onPreview(cursor.pitch);
      }
      return;
    }
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
      dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!dx && !dy) return;
    if (e.shiftKey && hit) {
      const n = dx
        ? { ...hit, length: clamp(hit.length + dx, 1, 16 - hit.start) }
        : moveNote(hit, 0, dy);
      onChange(placeNote(notes, n));
      setCursor({ start: n.start, pitch: n.pitch });
      if (dy) onPreview(n.pitch);
    } else {
      const next = {
        start: clamp(cursor.start + dx, 0, 15),
        pitch: clamp(cursor.pitch + dy, 0, 24),
      };
      setCursor(next);
      if (dy) onPreview(next.pitch);
    }
  }
  function label(pitch: number) {
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440)) + pitch;
    return `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }
  return (
    <div className="piano-scroll">
      <div className="piano-roll">
        <div className="piano-ruler">
          <span />
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i}>{i % 4 === 0 ? i / 4 + 1 : "·"}</span>
          ))}
        </div>
        <div className="piano-body">
          <div className="piano-keys">
            {Array.from({ length: 25 }, (_, i) => {
              const pitch = 24 - i;
              return (
                <button
                  key={pitch}
                  className={label(pitch).includes("♯") ? "black-key" : ""}
                  aria-label={`Preview ${label(pitch)}`}
                  onClick={() => onPreview(pitch)}
                >
                  {label(pitch)}
                </button>
              );
            })}
          </div>
          <div
            ref={grid}
            className="note-grid"
            role="grid"
            aria-label="Piano roll. Drag empty space to draw a note and its length. Tap a note to erase; drag to move. Arrow keys select a cell; Enter toggles a note. Shift arrows resize or transpose a note."
            tabIndex={0}
            onKeyDown={key}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={(e) => finish(e)}
            onPointerCancel={(e) => finish(e, true)}
            onLostPointerCapture={(e) => {
              if (gesture.current) finish(e, true);
            }}
          >
            {Array.from({ length: 25 }, (_, i) => (
              <div
                className={`piano-row ${label(24 - i).includes("♯") ? "dark-row" : ""}`}
                key={i}
              />
            ))}
            {shown.map((n) => (
              <div
                key={n.id}
                data-note={n.id}
                role="gridcell"
                aria-label={`${label(n.pitch)}, step ${n.start + 1}, length ${n.length}`}
                className={`piano-note ${draft?.id === n.id ? "note-draft" : ""}`}
                style={{
                  left: `${(n.start / 16) * 100}%`,
                  top: `${((24 - n.pitch) / 25) * 100}%`,
                  width: `${(n.length / 16) * 100}%`,
                  height: "4%",
                }}
              >
                <span />
              </div>
            ))}
            <div
              className="note-cursor"
              style={{
                left: `${(cursor.start / 16) * 100}%`,
                top: `${((24 - cursor.pitch) / 25) * 100}%`,
              }}
            />
            {step >= 0 && (
              <div
                className="piano-playhead"
                style={{ left: `${((step % 16) / 16) * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
