"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play } from "lucide-react";
import { MicrophoneRecording, microphoneError } from "../lib/microphone";
import { prepareAudioPlayback } from "../lib/audio-session";
import fftWorkerUrl from "../lib/resynthesis.worker?worker&url";
import { runFFT, cachedConstruction } from "../lib/fft-job";
import { selectedSound, type SoundCapture } from "../lib/sound-window";
import { SoundWindow } from "./SoundWindow";
import {
  MAX_PARTIALS,
  SAMPLE_RATE,
  type Reconstruction,
  type ConstructionWave,
} from "../lib/resynthesis";

export function SoundRecorder({
  reconstruction,
  active,
  stopRevision,
  initialCapture,
  onCaptureChange,
  onApply,
  getAudioContext,
  onCaptureStatus,
  onWorkStatus,
  playing,
}: {
  reconstruction?: Reconstruction;
  active: boolean;
  stopRevision: number;
  initialCapture?: SoundCapture;
  onCaptureChange: (capture: SoundCapture) => void;
  onApply: (model: Reconstruction, samples: Float32Array) => void;
  getAudioContext: () => AudioContext;
  onCaptureStatus: (capturing: boolean) => void;
  onWorkStatus: (busy: boolean) => void;
  playing: boolean;
}) {
  const [model, setModel] = useState(reconstruction);
  const [count, setCount] = useState(
    Math.min(
      initialCapture?.count ?? reconstruction?.count ?? 32,
      MAX_PARTIALS,
    ),
  );
  const [wave, setWave] = useState<ConstructionWave>(
    initialCapture?.wave ?? reconstruction?.wave ?? "sine",
  );
  const playingNow = useRef(playing);
  playingNow.current = playing;
  const [capture, setCapture] = useState<SoundCapture | null>(
    initialCapture ?? null,
  );
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
  const job = useRef<AbortController | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const alive = useRef(true);
  const previewVersion = useRef(0);
  useEffect(() => {
    stopPreview();
  }, [stopRevision, playing]);
  useEffect(() => {
    onCaptureStatus(status === "recording" || status === "permission");
    return () => onCaptureStatus(false);
  }, [status]);
  const previousModel = useRef(reconstruction);
  useEffect(() => {
    if (previousModel.current === reconstruction) return;
    previousModel.current = reconstruction;
    setModel(reconstruction);
    setCount(Math.min(reconstruction?.count ?? 32, MAX_PARTIALS));
    setWave(reconstruction?.wave ?? "sine");
  }, [reconstruction]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      microphone.current?.dispose();
      job.current?.abort();
      source.current?.stop();
    };
  }, []);
  useEffect(() => {
    onWorkStatus(status !== "idle" || audition !== null);
    return () => onWorkStatus(false);
  }, [status, audition]);
  useEffect(() => {
    if (capture && (capture.count !== count || capture.wave !== wave)) {
      rememberCapture({ ...capture, count, wave });
    }
  }, [count, wave, capture]);
  function stopPreview() {
    previewVersion.current++;
    source.current?.stop();
    source.current = null;
    setAudition(null);
  }
  async function audioContext() {
    prepareAudioPlayback();
    const context = getAudioContext();
    await context.resume();
    return context;
  }
  async function preview(
    samples: Float32Array,
    kind: "original" | "reconstruction",
  ) {
    stopPreview();
    const version = previewVersion.current;
    const ctx = await audioContext();
    if (
      !alive.current ||
      playingNow.current ||
      version !== previewVersion.current
    )
      return;
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
  function rememberCapture(next: SoundCapture) {
    setCapture(next);
    onCaptureChange(next);
  }
  async function startRecording() {
    setError("");
    setElapsed(0);
    setPeak(0);
    setStatus("permission");
    const mic = (microphone.current = new MicrophoneRecording(
      getAudioContext(),
    ));
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
    mic.onComplete = (samples) => {
      if (!alive.current) return;
      // Preserve the full recording immediately, independently of FFT startup.
      rememberCapture({ samples, window: [0, samples.length] });
      setElapsed(samples.length / SAMPLE_RATE);
      setPeak(0);
      setStatus("idle");
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
  async function playConstruction(selectedWave = wave, audition = true) {
    const sourceModel = reconstruction ?? model;
    if ((!capture && !sourceModel) || (audition && playingNow.current)) return;
    stopPreview();
    const previewId = previewVersion.current;
    setError("");
    setStatus(capture ? "analyzing" : "rendering");
    job.current?.abort();
    const controller = (job.current = new AbortController());
    try {
      if (!playingNow.current) await audioContext();
      if (!alive.current) return;
      const source = capture ? capture.samples : sourceModel!.frames;
      const key = `${capture ? capture.window.join(":") : "full"}:${count}:${selectedWave}`;
      const result = await cachedConstruction(source, key, () =>
        runFFT(
          capture
            ? { samples: selectedSound(capture), count, wave: selectedWave }
            : { model: { ...sourceModel!, count, wave: selectedWave } },
          () => new Worker(fftWorkerUrl, { type: "module" }),
          controller.signal,
        ),
      );
      if (!alive.current || controller.signal.aborted) return;
      setModel(result.model);
      if (capture)
        rememberCapture({
          ...capture,
          count,
          wave: selectedWave,
          appliedModel: result.model,
          appliedWindow: [...capture.window],
        });
      if (result.model !== reconstruction || !active)
        onApply(result.model, result.samples);
      setStatus("idle");
      if (!playingNow.current && previewId === previewVersion.current)
        await preview(result.samples, "reconstruction");
    } catch (error) {
      if (alive.current) {
        setError(microphoneError(error));
        setStatus("idle");
      }
    }
  }
  const busy = status !== "idle";
  return (
    <div className="sound-recorder">
      <div className="section-label">FFT</div>
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
            : capture
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
      <SoundWindow
        capture={capture}
        disabled={busy}
        onChange={(window) => {
          if (!capture) return;
          stopPreview();
          setError("");
          rememberCapture({ ...capture, window });
        }}
      />
      <label className="control frequency-count">
        <span>
          Waves <output>{count}</output>
        </span>
        <input
          type="range"
          aria-label="Construction wave count"
          min={1}
          max={MAX_PARTIALS}
          step={1}
          value={count}
          disabled={busy}
          onChange={(e) => setCount(+e.target.value)}
        />
      </label>
      <div className="frequency-options">
        {[1, 4, 8, 16, 32].map((n) => (
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
      <div className="construction-waves" aria-label="Construction wave shape">
        {(["sine", "triangle", "square"] as const).map((shape) => (
          <button
            key={shape}
            disabled={busy}
            aria-label={`Construct with ${shape} waves`}
            aria-pressed={wave === shape}
            onClick={() => {
              stopPreview();
              setWave(shape);
              // Stored FFT frequencies, amplitudes and phases are sufficient;
              // a raw microphone take is optional when changing the wave shape.
              if (capture || reconstruction || model)
                void playConstruction(shape, false);
            }}
          >
            {shape}
          </button>
        ))}
      </div>
      <div className="reconstruction-actions">
        <button
          disabled={!capture || busy || playing}
          aria-pressed={audition === "original"}
          onClick={() => {
            if (audition === "original") stopPreview();
            else if (capture)
              void preview(selectedSound(capture), "original").catch((e) =>
                setError(microphoneError(e)),
              );
          }}
        >
          {audition === "original" ? <Square size={12} /> : <Play size={12} />}
          Original
        </button>
        <button
          disabled={(!capture && !model) || busy || playing}
          aria-pressed={audition === "reconstruction"}
          onClick={() =>
            audition === "reconstruction"
              ? stopPreview()
              : void playConstruction()
          }
        >
          {audition === "reconstruction" ? (
            <Square size={12} />
          ) : (
            <Play size={12} />
          )}
          Construction
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
