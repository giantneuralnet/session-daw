"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, AudioLines } from "lucide-react";
import { MicrophoneRecording, microphoneError } from "../lib/microphone";
import {
  MAX_PARTIALS,
  SAMPLE_RATE,
  type Reconstruction,
} from "../lib/resynthesis";

export function SoundRecorder({
  reconstruction,
  active,
  stopRevision,
  onApply,
  onCaptureStart,
}: {
  reconstruction?: Reconstruction;
  active: boolean;
  stopRevision: number;
  onApply: (model: Reconstruction, samples: Float32Array) => void;
  onCaptureStart: () => void;
}) {
  const [model, setModel] = useState(reconstruction);
  const [count, setCount] = useState(reconstruction?.count ?? 32);
  const [original, setOriginal] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState<
    "idle" | "permission" | "recording" | "analyzing" | "rendering"
  >("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [peak, setPeak] = useState(0);
  const [audition, setAudition] = useState<
    "original" | "reconstruction" | null
  >(null);
  const microphone = useRef<MicrophoneRecording | null>(null);
  const worker = useRef<Worker | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const alive = useRef(true);
  const accepted = useRef(reconstruction);
  const previewVersion = useRef(0);
  useEffect(() => {
    stopPreview();
  }, [stopRevision]);
  useEffect(() => {
    setModel(reconstruction);
    setCount(reconstruction?.count ?? 32);
    if (reconstruction !== accepted.current) setOriginal(null);
    accepted.current = reconstruction;
  }, [reconstruction]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      microphone.current?.dispose();
      worker.current?.terminate();
      source.current?.stop();
      void context.current?.close();
    };
  }, []);
  function stopPreview() {
    previewVersion.current++;
    source.current?.stop();
    source.current = null;
    setAudition(null);
  }
  async function audioContext() {
    if (!context.current) context.current = new AudioContext();
    await context.current.resume();
    return context.current;
  }
  async function preview(
    samples: Float32Array,
    kind: "original" | "reconstruction",
  ) {
    stopPreview();
    const version = previewVersion.current;
    const ctx = await audioContext();
    if (!alive.current || version !== previewVersion.current) return;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    // Short fades prevent edge clicks; both A/B previews use identical gain.
    const now = ctx.currentTime,
      duration = samples.length / SAMPLE_RATE;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.8, now + 0.005);
    gain.gain.setValueAtTime(0.8, now + Math.max(0.005, duration - 0.01));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    node.connect(gain);
    gain.connect(ctx.destination);
    source.current = node;
    setAudition(kind);
    node.onended = () => {
      node.disconnect();
      gain.disconnect();
      if (source.current === node) {
        source.current = null;
        if (alive.current) setAudition(null);
      }
    };
    node.start();
  }
  function compute(
    data: { samples: Float32Array } | { model: Reconstruction },
  ): Promise<{ model?: Reconstruction; samples?: Float32Array }> {
    worker.current?.terminate();
    const w = (worker.current = new Worker(
      new URL("../lib/resynthesis.worker.ts", import.meta.url),
      { type: "module" },
    ));
    return new Promise((resolve, reject) => {
      w.onmessage = ({ data }) => {
        w.terminate();
        worker.current = null;
        data.error ? reject(Error(data.error)) : resolve(data);
      };
      w.onerror = () => {
        w.terminate();
        worker.current = null;
        reject(Error("Could not analyze this sound. Try recording again."));
      };
      w.postMessage(data);
    });
  }
  async function startRecording() {
    stopPreview();
    setError("");
    setElapsed(0);
    setPeak(0);
    setStatus("permission");
    onCaptureStart();
    const mic = (microphone.current = new MicrophoneRecording());
    mic.onProgress = (time, level) => {
      if (alive.current) {
        setElapsed(time);
        setPeak(level);
      }
    };
    mic.onError = (message) => {
      if (alive.current) {
        setError(message);
        setStatus("idle");
      }
    };
    mic.onComplete = async (samples) => {
      if (!alive.current) return;
      setStatus("analyzing");
      setPeak(0);
      try {
        const result = await compute({ samples });
        if (alive.current) {
          setOriginal(result.samples ?? samples);
          setModel(result.model);
          setStatus("idle");
        }
      } catch (error) {
        if (alive.current) {
          setError(microphoneError(error));
          setStatus("idle");
        }
      }
    };
    try {
      await mic.start();
      if (alive.current) setStatus("recording");
    } catch (error) {
      mic.dispose();
      if (alive.current) {
        setError(microphoneError(error));
        setStatus("idle");
      }
    }
  }
  async function reconstruct(apply: boolean) {
    if (!model) return;
    stopPreview();
    setError("");
    setStatus("rendering");
    try {
      // Unlock output during the tap, before waiting for the worker.
      await audioContext();
      if (!alive.current) return;
      const next = { ...model, count: apply ? count : model.count };
      const { samples } = await compute({ model: next });
      if (!alive.current || !samples) return;
      if (apply) {
        accepted.current = next;
        setModel(next);
        onApply(next, samples);
      }
      setStatus("idle");
      await preview(samples, "reconstruction");
    } catch (error) {
      if (alive.current) {
        setError(microphoneError(error));
        setStatus("idle");
      }
    }
  }
  const busy = status !== "idle";
  const applied = active && !!model && model === reconstruction;
  return (
    <div className="sound-recorder">
      <div className="section-label">
        RECORD A SOUND{" "}
        <span>
          {applied && model
            ? `${model.count} frequencies · in use`
            : "5 seconds max"}
        </span>
      </div>
      <div className="capture-controls">
        <button
          className={status === "recording" ? "capturing" : ""}
          disabled={busy && status !== "recording"}
          onClick={() =>
            status === "recording"
              ? microphone.current?.stop()
              : void startRecording()
          }
        >
          {status === "recording" ? (
            <Square size={14} fill="currentColor" />
          ) : (
            <Mic size={15} />
          )}
          {status === "recording"
            ? "Stop"
            : original
              ? "Record again"
              : "Record sound"}
        </button>
        <div
          className="capture-meter"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(peak * 100)}
        >
          <i style={{ width: `${Math.min(100, peak * 100)}%` }} />
        </div>
        <output>{elapsed.toFixed(1)} s</output>
      </div>
      <label className="control frequency-count">
        <span>
          Frequencies <output>{count}</output>
        </span>
        <input
          type="range"
          aria-label="Reconstruction frequencies"
          min={1}
          max={MAX_PARTIALS}
          step={1}
          value={count}
          disabled={busy}
          onChange={(e) => setCount(+e.target.value)}
        />
      </label>
      <div className="frequency-options">
        {[1, 8, 16, 32, 64, 128].map((n) => (
          <button
            key={n}
            disabled={busy}
            aria-pressed={count === n}
            onClick={() => setCount(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="reconstruction-actions">
        <button
          className="reconstruct-button"
          disabled={!model || busy}
          onClick={() => void reconstruct(true)}
        >
          <AudioLines size={15} />
          Reconstruct
        </button>
        <button
          disabled={!original || busy}
          aria-pressed={audition === "original"}
          onClick={() => {
            if (audition === "original") stopPreview();
            else if (original)
              void preview(original, "original").catch((e) =>
                setError(microphoneError(e)),
              );
          }}
        >
          {audition === "original" ? <Square size={12} /> : <Play size={12} />}
          Original
        </button>
        <button
          disabled={!applied || busy}
          aria-pressed={audition === "reconstruction"}
          onClick={() =>
            audition === "reconstruction"
              ? stopPreview()
              : void reconstruct(false)
          }
        >
          {audition === "reconstruction" ? (
            <Square size={12} />
          ) : (
            <Play size={12} />
          )}
          Reconstruction
        </button>
      </div>
      <div className="capture-status" role="status">
        {status === "permission"
          ? "Waiting for microphone…"
          : status === "recording"
            ? "Recording…"
            : status === "analyzing"
              ? "Analyzing sound…"
              : status === "rendering"
                ? "Reconstructing…"
                : model && (!applied || count !== model.count)
                  ? "Reconstruct to hear and use this sound."
                  : model
                    ? `${(model.length / SAMPLE_RATE).toFixed(1)} s · ${model.count} frequencies per frame`
                    : ""}
      </div>
      {error && (
        <p className="capture-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
