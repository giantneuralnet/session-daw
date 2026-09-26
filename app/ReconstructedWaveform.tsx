"use client";
import { useEffect, useRef } from "react";
import { renderedSound, type Reconstruction } from "../lib/resynthesis";
import { waveformPeaks } from "../lib/sound-window";

export function ReconstructedWaveform({
  model,
  color,
}: {
  model: Reconstruction;
  color: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const samples = renderedSound(model);
    const draw = () => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = width * dpr;
      element.height = height * dpr;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#30313a";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      const peaks = waveformPeaks(samples, Math.ceil(width));
      let peak = 0.01;
      for (const [min, max] of peaks) peak = Math.max(peak, -min, max);
      ctx.strokeStyle = color;
      ctx.beginPath();
      peaks.forEach(([min, max], x) => {
        ctx.moveTo(x + 0.5, height / 2 - (max / peak) * height * 0.42);
        ctx.lineTo(x + 0.5, height / 2 - (min / peak) * height * 0.42 + 0.5);
      });
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [model, color]);
  return (
    <canvas ref={canvas} role="img" aria-label="Full reconstructed waveform" />
  );
}
