"use client";
import { useEffect, useRef, type PointerEvent } from "react";
import { SAMPLE_RATE } from "../lib/resynthesis";
import {
  MIN_WINDOW,
  moveWindow,
  waveformPeaks,
  type SoundCapture,
  type SoundWindow as Range,
} from "../lib/sound-window";

export function SoundWindow({
  capture,
  disabled,
  onChange,
}: {
  capture: SoundCapture | null;
  disabled: boolean;
  onChange: (window: Range) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; edge: 0 | 1 } | null>(null);
  const current = useRef(capture);
  current.current = capture;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const width = Math.max(1, element.clientWidth),
        height = 112;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = width * dpr;
      element.height = height * dpr;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#353740";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      if (!capture) return;
      const peaks = waveformPeaks(capture.samples, Math.ceil(width));
      let peak = 0.01;
      for (const [min, max] of peaks) peak = Math.max(peak, -min, max);
      ctx.strokeStyle =
        getComputedStyle(element).getPropertyValue("--track").trim() ||
        "#a89bdd";
      ctx.beginPath();
      peaks.forEach(([min, max], x) => {
        ctx.moveTo(x + 0.5, height / 2 - (max / peak) * 46);
        ctx.lineTo(x + 0.5, height / 2 - (min / peak) * 46 + 0.5);
      });
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [capture?.samples]);
  function update(edge: 0 | 1, value: number) {
    const c = current.current;
    if (disabled || !c) return;
    const next = moveWindow(c.window, edge, value, c.samples.length);
    current.current = { ...c, window: next };
    onChange(next);
  }
  function pointer(e: PointerEvent, edge?: 0 | 1) {
    if (!capture || disabled || (e.pointerType === "mouse" && e.button !== 0))
      return;
    const bounds = area.current!.getBoundingClientRect();
    const position =
      ((e.clientX - bounds.left) / bounds.width) * capture.samples.length;
    const chosen =
      edge ??
      (Math.abs(position - capture.window[0]) <
      Math.abs(position - capture.window[1])
        ? 0
        : 1);
    drag.current = { pointer: e.pointerId, edge: chosen };
    area.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }
  const length = capture?.samples.length ?? 1;
  const selection: Range = capture?.window ?? [0, length];
  return (
    <div className="fft-window">
      <div
        ref={area}
        className={`fft-waveform ${capture ? "has-audio" : ""}`}
        onPointerDown={(e) => pointer(e)}
        onPointerMove={(e) => {
          if (!drag.current || drag.current.pointer !== e.pointerId) return;
          const bounds = area.current!.getBoundingClientRect();
          update(
            drag.current.edge,
            ((e.clientX - bounds.left) / bounds.width) * length,
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={
            capture
              ? "Recorded sound waveform"
              : "Record a sound to see its waveform"
          }
        />
        {!capture && <span className="fft-empty">Record a sound</span>}
        {capture && (
          <>
            <div
              className="fft-outside"
              style={{ left: 0, width: `${(selection[0] / length) * 100}%` }}
            />
            <div
              className="fft-outside"
              style={{
                right: 0,
                width: `${(1 - selection[1] / length) * 100}%`,
              }}
            />
            <div
              className="fft-selected"
              style={{
                left: `${(selection[0] / length) * 100}%`,
                width: `${((selection[1] - selection[0]) / length) * 100}%`,
              }}
            />
            {([0, 1] as const).map((edge) => (
              <button
                key={edge}
                className={`fft-handle ${edge ? "end" : "start"}`}
                role="slider"
                aria-label={edge ? "Selection end" : "Selection start"}
                disabled={disabled}
                aria-valuemin={
                  edge ? (selection[0] + MIN_WINDOW) / SAMPLE_RATE : 0
                }
                aria-valuemax={
                  edge
                    ? length / SAMPLE_RATE
                    : (selection[1] - MIN_WINDOW) / SAMPLE_RATE
                }
                aria-valuenow={selection[edge] / SAMPLE_RATE}
                aria-valuetext={`${(selection[edge] / SAMPLE_RATE).toFixed(3)} seconds`}
                style={{ left: `${(selection[edge] / length) * 100}%` }}
                onPointerDown={(e) => pointer(e, edge)}
                onKeyDown={(e) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  e.stopPropagation();
                  update(
                    edge,
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? length
                        : selection[edge] +
                          (e.key === "ArrowLeft" ? -1 : 1) *
                            SAMPLE_RATE *
                            (e.shiftKey ? 0.1 : 0.01),
                  );
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
