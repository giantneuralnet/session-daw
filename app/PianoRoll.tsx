"use client";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { MIN_PITCH, MAX_PITCH, type Note } from "../lib/session";
import {
  clamp,
  drawNote,
  moveNote,
  resizeNote,
  placeNote,
  finishGesture,
} from "../lib/piano-roll";
const ROW_HEIGHT = 18,
  ROWS = MAX_PITCH - MIN_PITCH + 1;
type Gesture = {
  pointer: number;
  original: Note;
  anchor: number;
  pitch: number;
  x: number;
  y: number;
  scrollTop: number;
  mode: "empty" | "move" | "resize";
  moved: boolean;
  draft: Note;
};
export function PianoRoll({
  notes,
  onChange,
  onPreview,
  frequency,
  step,
  revision,
}: {
  notes: Note[];
  onChange: (notes: Note[]) => void;
  onPreview: (pitch: number) => void;
  frequency: number;
  step: number;
  revision: number;
}) {
  const grid = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    initialPitch = useRef(
      notes.length ? notes.reduce((s, n) => s + n.pitch, 0) / notes.length : 12,
    );
  const [draft, setDraft] = useState<Note | null>(null),
    [cursor, setCursor] = useState({
      start: 0,
      pitch: Math.round(initialPitch.current),
    });
  const twoFinger = useRef<{
    x: number;
    y: number;
    top: number;
    left: number;
  } | null>(null);
  const shown = draft ? placeNote(notes, draft) : notes;
  useEffect(() => {
    if (viewport.current)
      viewport.current.scrollTop =
        (MAX_PITCH - initialPitch.current) * ROW_HEIGHT -
        viewport.current.clientHeight / 2;
  }, []);
  useEffect(() => {
    gesture.current = null;
    setDraft(null);
  }, [revision]);
  useEffect(() => {
    const view = viewport.current!;
    const horizontal = view.closest<HTMLElement>(".piano-scroll")!;
    const begin = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      const g = gesture.current;
      gesture.current = null;
      setDraft(null);
      if (g && grid.current?.hasPointerCapture(g.pointer))
        grid.current.releasePointerCapture(g.pointer);
      twoFinger.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        top: view.scrollTop,
        left: horizontal.scrollLeft,
      };
      e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      const pan = twoFinger.current;
      if (!pan) return;
      e.preventDefault();
      if (e.touches.length < 2) return;
      view.scrollTop =
        pan.top + pan.y - (e.touches[0].clientY + e.touches[1].clientY) / 2;
      horizontal.scrollLeft =
        pan.left + pan.x - (e.touches[0].clientX + e.touches[1].clientX) / 2;
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) twoFinger.current = null;
    };
    view.addEventListener("touchstart", begin, { passive: false });
    view.addEventListener("touchmove", move, { passive: false });
    view.addEventListener("touchend", end);
    view.addEventListener("touchcancel", end);
    return () => {
      view.removeEventListener("touchstart", begin);
      view.removeEventListener("touchmove", move);
      view.removeEventListener("touchend", end);
      view.removeEventListener("touchcancel", end);
    };
  }, []);
  function cell(e: PointerEvent) {
    const r = grid.current!.getBoundingClientRect();
    return {
      start: clamp(Math.floor(((e.clientX - r.left) / r.width) * 16), 0, 15),
      pitch:
        MAX_PITCH -
        clamp(Math.floor((e.clientY - r.top) / ROW_HEIGHT), 0, ROWS - 1),
    };
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || gesture.current || twoFinger.current) return;
    const at = cell(e),
      target = e.target as HTMLElement,
      id = target.closest<HTMLElement>("[data-note]")?.dataset.note,
      existing = notes.find((n) => n.id === id);
    const note =
      existing ?? drawNote(crypto.randomUUID(), at.start, at.start, at.pitch);
    const mode = existing
      ? target.closest("[data-resize]")
        ? "resize"
        : "move"
      : "empty";
    if (existing) e.preventDefault();
    gesture.current = {
      pointer: e.pointerId,
      original: note,
      anchor: at.start,
      pitch: at.pitch,
      x: e.clientX,
      y: e.clientY,
      scrollTop: viewport.current!.scrollTop,
      mode,
      moved: false,
      draft: note,
    };
    grid.current!.setPointerCapture(e.pointerId);
    grid.current!.focus({ preventScroll: true });
    setCursor(at);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) g.moved = true;
    if (!g.moved) return;
    if (g.mode === "empty") {
      if (e.pointerType === "mouse")
        viewport.current!.scrollTop = g.scrollTop + g.y - e.clientY;
      return;
    }
    const at = cell(e),
      next =
        g.mode === "resize"
          ? resizeNote(g.original, at.start)
          : moveNote(g.original, at.start - g.anchor, at.pitch - g.pitch);
    if (next.pitch !== g.draft.pitch) onPreview(next.pitch);
    g.draft = next;
    setDraft(next);
    setCursor({ start: next.start, pitch: next.pitch });
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancel = false) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    gesture.current = null;
    setDraft(null);
    if (!cancel) {
      const result = finishGesture(notes, g.mode, g.original, g.draft, g.moved);
      if (result.notes !== notes) onChange(result.notes);
      if (result.preview !== null) onPreview(result.preview);
    }
    if (grid.current?.hasPointerCapture(e.pointerId))
      grid.current.releasePointerCapture(e.pointerId);
  }
  function reveal(pitch: number) {
    const v = viewport.current;
    if (!v) return;
    const y = (MAX_PITCH - pitch) * ROW_HEIGHT;
    if (y < v.scrollTop) v.scrollTop = y;
    if (y + ROW_HEIGHT > v.scrollTop + v.clientHeight)
      v.scrollTop = y + ROW_HEIGHT - v.clientHeight;
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (gesture.current || e.metaKey || e.ctrlKey) return;
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
        ? resizeNote(hit, hit.start + hit.length - 1 + dx)
        : moveNote(hit, 0, dy);
      onChange(placeNote(notes, n));
      setCursor({ start: n.start, pitch: n.pitch });
      reveal(n.pitch);
      if (dy && n.pitch !== hit.pitch) onPreview(n.pitch);
    } else {
      const next = {
        start: clamp(cursor.start + dx, 0, 15),
        pitch: clamp(cursor.pitch + dy, MIN_PITCH, MAX_PITCH),
      };
      setCursor(next);
      reveal(next.pitch);
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
        <div
          ref={viewport}
          className="pitch-viewport"
          onScroll={() => {
            if (gesture.current?.mode === "empty") gesture.current.moved = true;
          }}
          onWheel={() => {
            if (gesture.current?.mode === "empty") gesture.current.moved = true;
          }}
        >
          <div className="piano-body">
            <div className="piano-keys">
              {Array.from({ length: ROWS }, (_, i) => {
                const pitch = MAX_PITCH - i;
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
              style={{ height: ROWS * ROW_HEIGHT }}
              role="grid"
              aria-label="Piano roll. Tap empty space to add a note. Tap a note to erase silently. Scroll or drag empty space to browse pitches. Drag notes to move; drag their right edge to resize. Arrow keys select; Enter toggles notes; Shift arrows resize or transpose."
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
              {Array.from({ length: ROWS }, (_, i) => (
                <div
                  className={`piano-row ${label(MAX_PITCH - i).includes("♯") ? "dark-row" : ""}`}
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
                    top: (MAX_PITCH - n.pitch) * ROW_HEIGHT,
                    width: `${(n.length / 16) * 100}%`,
                    height: ROW_HEIGHT,
                  }}
                >
                  <span />
                  <i
                    data-resize="true"
                    className="note-resize"
                    title="Drag to resize note"
                  />
                </div>
              ))}
              <div
                className="note-cursor"
                style={{
                  left: `${(cursor.start / 16) * 100}%`,
                  top: (MAX_PITCH - cursor.pitch) * ROW_HEIGHT,
                  height: ROW_HEIGHT,
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
    </div>
  );
}
