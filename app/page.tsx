"use client";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  Play,
  ArrowDown,
  ArrowUp,
  Undo2,
  Redo2,
  ClipboardPaste,
  Share2,
  Square,
  Circle,
  Plus,
  FolderOpen,
  Download,
  SlidersHorizontal,
  AudioLines,
  Trash2,
  Copy,
  X,
  Check,
  Power,
  Music2,
} from "lucide-react";
import { shareAudio } from "../lib/sharing";
import { noteShortcuts, parseBpm, stepBpm } from "../lib/music";
import { soundPresets } from "../lib/presets";
import { History } from "../lib/history";
import { pasteNotes } from "../lib/piano-roll";
import { PianoRoll } from "./PianoRoll";
import { SoundRecorder } from "./SoundRecorder";
import { ReconstructedWaveform } from "./ReconstructedWaveform";
import type { SoundCapture } from "../lib/sound-window";
import { AudioEngine } from "../lib/audio";
import {
  initialProject,
  emptyProject,
  ensureEmptyRow,
  columnLabel,
  type Note,
  makeTrack,
  parseProject,
  type Track,
  type Wave,
  type Project,
} from "../lib/session";
const waves: Wave[] = ["sine", "triangle", "sawtooth", "square", "noise"];
const db = (v: number) => (v === 0 ? "−∞" : (20 * Math.log10(v)).toFixed(1));
const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
function Waveform({
  wave,
  color = "#a89bdd",
  small = false,
}: {
  wave: Wave;
  color?: string;
  small?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = c.width,
      h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (!small) {
      ctx.strokeStyle = "#292b31";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += w / 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += h / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = small ? 2 : 2.5;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const p = (x / w) * (small ? 2 : 3),
        f = p % 1;
      const y =
        wave === "sine"
          ? Math.sin(p * Math.PI * 2)
          : wave === "triangle"
            ? 1 - 4 * Math.abs(f - 0.5)
            : wave === "sawtooth"
              ? 2 * f - 1
              : wave === "square"
                ? f < 0.5
                  ? 1
                  : -1
                : Math.sin(x * 29.2) * Math.cos(x * 7.8);
      const yy = h / 2 - y * h * 0.32;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }, [wave, color, small]);
  return (
    <canvas
      ref={ref}
      width={small ? 70 : 540}
      height={small ? 30 : 130}
      aria-label={`${wave} waveform`}
      role="img"
    />
  );
}
function Control({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="control">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
export default function Session() {
  const [project, setProject] = useState<Project>(initialProject),
    [selected, setSelected] = useState("track-2"),
    [clipIndex, setClipIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [step, setStep] = useState(-1),
    [queued, setQueued] = useState<Record<string, number>>({}),
    [recording, setRecording] = useState(false),
    [encoding, setEncoding] = useState(false),
    [finishing, setFinishing] = useState(false),
    [take, setTake] = useState<Blob | null>(null),
    [seconds, setSeconds] = useState(0),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState<"sound" | "pattern">("sound"),
    [levels, setLevels] = useState<Record<string, number>>({}),
    [showRecord, setShowRecord] = useState(false),
    [takeUrl, setTakeUrl] = useState(""),
    [atEditor, setAtEditor] = useState(false),
    [historyRevision, setHistoryRevision] = useState(0),
    [clipboard, setClipboard] = useState<Note[] | null>(null),
    [showTempo, setShowTempo] = useState(false),
    [bpmDraft, setBpmDraft] = useState("120"),
    [bpmError, setBpmError] = useState(""),
    [sharing, setSharing] = useState(false),
    [shareStatus, setShareStatus] = useState("");
  const [previewStopRevision, setPreviewStopRevision] = useState(0);
  const captures = useRef(new Map<string, SoundCapture>());
  const soundPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const microphoneActive = useRef(false);
  const history = useRef(new History<Project>()),
    state = useRef(project),
    engine = useRef<AudioEngine | null>(null),
    file = useRef<HTMLInputElement>(null),
    editor = useRef<HTMLElement>(null),
    tempoButton = useRef<HTMLButtonElement>(null),
    recordStart = useRef(0),
    recordBusy = useRef(false);
  state.current = project;
  const track =
      project.tracks.find((t) => t.id === selected) || project.tracks[0],
    clip = track.clips[clipIndex];
  function closeTempo() {
    setShowTempo(false);
    tempoButton.current?.focus();
  }
  function applyTempo() {
    const bpm = parseBpm(bpmDraft);
    if (bpm === null) {
      setBpmError("Enter a BPM from 40 to 240.");
      return;
    }
    edit((p) => ({ ...p, bpm }));
    closeTempo();
  }
  async function shareRecording() {
    if (!take || sharing) return;
    setSharing(true);
    setShareStatus("");
    try {
      const result = await shareAudio(
        take,
        state.current.name + ".mp3",
        navigator,
      );
      if (result === "unsupported") {
        download(take, state.current.name + ".mp3");
        setShareStatus(
          "File sharing is unavailable in this browser. Your MP3 was downloaded.",
        );
      }
    } catch {
      setShareStatus(
        "Could not share this recording. Export the MP3 to share it manually.",
      );
    } finally {
      setSharing(false);
    }
  }
  useEffect(() => {
    const gesture = (e: Event) => e.preventDefault();
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const touch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && ["+", "-", "=", "0"].includes(e.key))
        e.preventDefault();
    };
    document.addEventListener("gesturestart", gesture, { passive: false });
    document.addEventListener("gesturechange", gesture, { passive: false });
    document.addEventListener("touchmove", touch, { passive: false });
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("gesturestart", gesture);
      document.removeEventListener("gesturechange", gesture);
      document.removeEventListener("touchmove", touch);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  function edit(fn: (p: Project) => Project, remember = true) {
    const next = ensureEmptyRow(fn(state.current));
    if (remember && history.current.commit(state.current, next))
      setHistoryRevision((v) => v + 1);
    state.current = next;
    setProject(next);
  }
  function updateTrack(id: string, patch: Partial<Track>, audition = true) {
    edit(
      (p) => ({
        ...p,
        tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }),
      Object.keys(patch).some((key) => key !== "active"),
    );
    if (
      audition &&
      Object.keys(patch).some((key) =>
        [
          "wave",
          "frequency",
          "attack",
          "decay",
          "cutoff",
          "reverb",
          "echo",
          "pan",
          "volume",
          "kind",
        ].includes(key),
      )
    )
      scheduleSoundPreview(id);
  }
  function scheduleSoundPreview(id: string) {
    if (soundPreviewTimer.current) clearTimeout(soundPreviewTimer.current);
    if (
      playing ||
      engine.current?.playing ||
      engine.current?.finishing ||
      microphoneActive.current
    )
      return;
    const audio = getEngine();
    void audio.ctx.resume().catch(() => {});
    // Coalesce a slider gesture without creating hundreds of overlapping notes.
    soundPreviewTimer.current = setTimeout(() => {
      if (audio.playing || audio.finishing || microphoneActive.current) return;
      const next = state.current.tracks.find((t) => t.id === id);
      if (!next) return;
      audio.update(state.current);
      setPreviewStopRevision((v) => v + 1);
      void audio
        .preview(next, 0, true)
        .catch(() => setMessage("Audio preview could not start."));
    }, 90);
  }
  useEffect(
    () => () => {
      if (soundPreviewTimer.current) clearTimeout(soundPreviewTimer.current);
    },
    [selected, playing],
  );
  function restoreHistory(direction: "undo" | "redo") {
    const next = history.current[direction](state.current);
    if (!next) return;
    engine.current?.pending.clear();
    setQueued({});
    state.current = next;
    setProject(next);
    engine.current?.update(next);
    const destination =
      next.tracks.find((t) => t.id === selected) ?? next.tracks[0];
    setSelected(destination.id);
    setClipIndex((i) => Math.min(i, destination.clips.length - 1));
    setHistoryRevision((v) => v + 1);
  }
  function copyPattern() {
    if (!clip?.notes.length) return;
    setClipboard(structuredClone(clip.notes));
    setMessage("Notes copied");
  }
  function pastePattern() {
    if (clipboard) updateNotes(pasteNotes(clipboard));
  }
  useEffect(() => {
    const end = () => history.current.end();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);
  useEffect(() => {
    engine.current?.update(project);
  }, [project]);
  useEffect(() => () => engine.current?.dispose(), []);
  useEffect(() => {
    setShareStatus("");
    if (!take) {
      setTakeUrl("");
      return;
    }
    const url = URL.createObjectURL(take);
    setTakeUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [take]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(
      () => setSeconds((Date.now() - recordStart.current) / 1000),
      100,
    );
    return () => clearInterval(id);
  }, [recording]);
  useEffect(() => {
    if (!engine.current) {
      setLevels({});
      return;
    }
    const id = setInterval(() => {
      const e = engine.current;
      if (!e) return;
      const data = new Uint8Array(e.analyser.frequencyBinCount);
      const next: Record<string, number> = {};
      for (const [id, channel] of e.channels) {
        channel.analyser.getByteTimeDomainData(data);
        const peak = Math.max(...data.map((x) => Math.abs(x - 128))) / 128;
        next[id] =
          peak > 0
            ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 48) / 48))
            : 0;
      }
      setLevels(next);
    }, 70);
    return () => clearInterval(id);
  }, [playing, recording]);
  function getEngine() {
    if (!engine.current) {
      const e = new AudioEngine(state.current);
      e.onStep = (s, time) => {
        setTimeout(
          () => {
            if (e.playing) setStep(s);
          },
          Math.max(0, (time - e.ctx.currentTime) * 1000),
        );
      };
      e.onLaunch = (id, active) => {
        updateTrack(id, { active });
        setQueued((q) => {
          const n = { ...q };
          delete n[id];
          return n;
        });
      };
      e.onStopped = () => {
        setPlaying(false);
        setStep(-1);
        setQueued({});
        edit(
          (p) => ({
            ...p,
            tracks: p.tracks.map((t) => ({ ...t, active: -1 })),
          }),
          false,
        );
      };
      e.onRecordingFinalizing = () => {
        setSeconds((Date.now() - recordStart.current) / 1000);
        setRecording(false);
        setFinishing(false);
        setEncoding(true);
      };
      e.onRecorded = (blob) => {
        setTake(blob);
        setEncoding(false);
        setMessage("Recording ready to export");
      };
      e.onError = (m) => {
        setMessage(m);
        setEncoding(false);
        setRecording(false);
        setFinishing(false);
        e.endRecording();
      };
      engine.current = e;
    }
    return engine.current;
  }
  async function play() {
    if (finishing) return;
    try {
      const e = getEngine();
      e.update(state.current);
      await e.start();
      setPlaying(true);
    } catch {
      setMessage("Audio could not start. Please try again.");
    }
  }
  function stop() {
    if (soundPreviewTimer.current) clearTimeout(soundPreviewTimer.current);
    setPreviewStopRevision((v) => v + 1);
    engine.current?.stop();
    setPlaying(false);
    setStep(-1);
    setQueued({});
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showTempo) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeTempo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          restoreHistory(key === "y" || e.shiftKey ? "redo" : "undo");
          return;
        }
        if (tab === "pattern" && editor.current?.contains(e.target as Node)) {
          if (key === "c") {
            e.preventDefault();
            copyPattern();
            return;
          }
          if (key === "v") {
            e.preventDefault();
            pastePattern();
            return;
          }
        }
      }
      if (
        e.code === "Space" &&
        !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        if (engine.current?.playing) stop();
        else void play();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    const onScroll = () => setAtEditor(window.scrollY > 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  function toggleScroll() {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "instant"
      : "smooth";
    if (atEditor) {
      setAtEditor(false);
      window.scrollTo({ top: 0, behavior });
    } else {
      setTab("pattern");
      setAtEditor(true);
      requestAnimationFrame(() =>
        editor.current?.scrollIntoView({ behavior, block: "start" }),
      );
    }
  }
  function launch(t: Track, index: number) {
    if (finishing) return;
    if (playing) {
      getEngine().queue(t.id, index);
      setQueued((q) => ({ ...q, [t.id]: index }));
    } else {
      updateTrack(t.id, { active: index });
      if (index >= 0) void play();
    }
  }
  function launchClip(t: Track, index: number) {
    setSelected(t.id);
    setClipIndex(index);
    setTab("pattern");
    if (!t.clips[index]) {
      const clips = [...t.clips];
      clips[index] = { notes: [] };
      updateTrack(t.id, { clips });
      return;
    }
    launch(t, playing && (queued[t.id] ?? t.active) === index ? -1 : index);
  }
  function startFresh() {
    stop();
    engine.current?.dispose();
    engine.current = null;
    const fresh = emptyProject();
    edit(() => fresh);
    setSelected(fresh.tracks[0].id);
    setClipIndex(0);
    setTab("pattern");
    setTake(null);
    setSeconds(0);
    setShowRecord(false);
    setMessage("");
  }
  async function record() {
    if (recordBusy.current || finishing || encoding) return;
    if (recording) {
      finishRecording();
      return;
    }
    recordBusy.current = true;
    try {
      const e = getEngine();
      await e.record();
      setTake(null);
      setSeconds(0);
      recordStart.current = Date.now();
      setRecording(true);
      setShowRecord(false);
    } catch {
      setMessage("Recording is unavailable. Try a current browser over HTTPS.");
    } finally {
      recordBusy.current = false;
    }
  }
  function finishRecording() {
    if (finishing) {
      setShowRecord(true);
      return;
    }
    if (!recording) return;
    setFinishing(true);
    setShowRecord(true);
    setQueued({});
    engine.current?.finishRecording();
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function save() {
    download(
      new Blob([JSON.stringify(state.current, null, 2)], {
        type: "application/json",
      }),
      `${project.name}.json`,
    );
    setMessage("Session saved as JSON");
  }
  async function load(f?: File) {
    if (!f) return;
    try {
      if (f.size > 64 * 1024 * 1024)
        throw Error("Session file is too large (64 MB maximum).");
      const p = parseProject(await f.text());
      stop();
      edit(() => ({
        ...p,
        tracks: p.tracks.map((t) => ({ ...t, active: -1 })),
      }));
      setSelected(p.tracks[0].id);
      setClipIndex(0);
      setMessage("Session loaded");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not open this file.");
    }
    if (file.current) file.current.value = "";
  }
  function addTrack() {
    if (project.tracks.length >= 16) {
      setMessage("A session supports up to 16 tracks");
      return;
    }
    const t = makeTrack(project.tracks.length, project.tracks[0].clips.length);
    edit((p) => ({ ...p, tracks: [...p.tracks, t] }));
    setSelected(t.id);
    setClipIndex(0);
  }
  function updateNotes(notes: Note[]) {
    const clips = [...track.clips];
    clips[clipIndex] = { notes };
    updateTrack(track.id, { clips });
  }
  function previewPitch(pitch: number) {
    void getEngine()
      .preview(track, pitch)
      .catch(() => setMessage("Audio preview could not start."));
  }
  const activeCount = project.tracks.filter(
    (t) => t.active >= 0 && !t.mute,
  ).length;
  return (
    <main
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName === "INPUT" && target.type === "range")
          history.current.begin();
      }}
    >
      <header className="transport">
        <div className="transport-left">
          <div className="play-controls">
            <button
              aria-label={playing ? "Stop playback" : "Play session"}
              title="Play / stop · Space"
              className={playing ? "play active" : "play"}
              onClick={() => (playing ? stop() : void play())}
            >
              <Play size={17} fill="currentColor" />
            </button>
            <button aria-label="Stop and reset" onClick={stop}>
              <Square size={14} fill="currentColor" />
            </button>
            <button
              aria-label={recording ? "Finish recording" : "Record session"}
              title="Record session"
              className={recording ? "record is-recording" : "record"}
              disabled={encoding || finishing}
              onClick={() => void record()}
            >
              <Circle size={14} fill="currentColor" />
            </button>
          </div>
          <button
            className="tempo"
            ref={tempoButton}
            aria-label={`Edit tempo, ${project.bpm} BPM`}
            aria-haspopup="dialog"
            onClick={() => {
              setBpmDraft(String(project.bpm));
              setBpmError("");
              setShowTempo(true);
            }}
          >
            <b>{project.bpm}</b>
            <span>BPM</span>
          </button>
          <span className="signature">4 / 4</span>
          <div className="position">
            {String(step < 0 ? 1 : Math.floor(step / 16) + 1).padStart(3, "0")}
            <span>.</span>
            {step < 0 ? 1 : Math.floor((step % 16) / 4) + 1}
            <span>.</span>
            {step < 0 ? 1 : (step % 4) + 1}
          </div>
          <div className="beat-dots">
            {[0, 1, 2, 3].map((i) => (
              <i
                key={i}
                className={
                  playing && Math.floor((step % 16) / 4) === i ? "lit" : ""
                }
              />
            ))}
          </div>
        </div>
        <div className="file-controls">
          <div className="history-controls">
            <button
              aria-label="Undo"
              title="Undo · Ctrl/⌘ Z"
              disabled={!history.current.canUndo}
              onClick={() => restoreHistory("undo")}
            >
              <Undo2 size={15} />
            </button>
            <button
              aria-label="Redo"
              title="Redo · Ctrl/⌘ Shift Z"
              disabled={!history.current.canRedo}
              onClick={() => restoreHistory("redo")}
            >
              <Redo2 size={15} />
            </button>
          </div>
          <button
            onClick={startFresh}
            disabled={recording || encoding}
            title="New empty session"
          >
            <Plus size={15} />
            <span>New</span>
          </button>
          <button onClick={() => file.current?.click()}>
            <FolderOpen size={15} />
            <span>Open</span>
          </button>
          <button onClick={save}>
            <Download size={15} />
            <span>Save</span>
            <small>.json</small>
          </button>
          <i />
          <button
            className="export"
            onClick={() =>
              recording ? finishRecording() : setShowRecord(true)
            }
          >
            <AudioLines size={16} />
            <span>Export MP3</span>
          </button>
        </div>
        <input
          hidden
          type="file"
          accept=".json,application/json"
          ref={file}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </header>
      <section className="workspace">
        <div className="grid-scroll">
          <div
            className="tracks"
            style={{ "--count": project.tracks.length } as CSSProperties}
          >
            <div className="row-labels">
              {project.tracks[0].clips.map((_, j) => (
                <button
                  key={j}
                  aria-label={`Launch row ${j + 1}`}
                  onClick={() =>
                    project.tracks.forEach((t) =>
                      launch(t, t.clips[j] ? j : -1),
                    )
                  }
                >
                  {j + 1}
                </button>
              ))}
            </div>
            {project.tracks.map((t, i) => (
              <div
                key={t.id}
                className={`track ${t.id === track.id ? "selected" : ""}`}
                style={{ "--track": t.color } as CSSProperties}
              >
                <div className="clip-slots">
                  {t.clips.map((c, j) => (
                    <div
                      key={j}
                      className={`clip ${c ? "filled" : "empty"} ${t.active === j ? "on" : ""} ${queued[t.id] === j ? "queued" : ""} ${t.id === track.id && clipIndex === j ? "clip-selected" : ""}`}
                    >
                      <button
                        className="clip-edit"
                        aria-label={`${c ? (playing && (queued[t.id] ?? t.active) === j ? "Stop" : "Play") : "Create"} ${columnLabel(i)}${j + 1} and edit`}
                        aria-pressed={!!c && playing && t.active === j}
                        onClick={() => launchClip(t, j)}
                      >
                        <span className="clip-coordinate">
                          {columnLabel(i)}
                          {j + 1}
                        </span>
                        {c ? (
                          <div className="mini-notes">
                            {c.notes.map((n) => (
                              <i
                                key={n.id}
                                style={{
                                  left: `${(n.start / 16) * 100}%`,
                                  width: `${(n.length / 16) * 100}%`,
                                  bottom: `${Math.max(0, Math.min(100, ((n.pitch + 36) / 96) * 100))}%`,
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <Plus size={12} />
                        )}
                      </button>
                      {c && (
                        <button
                          className="clip-launch"
                          title={`${playing && (queued[t.id] ?? t.active) === j ? "Stop" : "Play"} ${columnLabel(i)}${j + 1}`}
                          aria-label={`${playing && (queued[t.id] ?? t.active) === j ? "Stop" : "Play"} ${columnLabel(i)}${j + 1}`}
                          onClick={() => launchClip(t, j)}
                        >
                          {playing && t.active === j ? (
                            <Square size={9} fill="currentColor" />
                          ) : (
                            <Play size={11} fill="currentColor" />
                          )}
                        </button>
                      )}
                      {c && t.active === j && (
                        <div
                          className="clip-progress"
                          style={{
                            width: playing
                              ? `${(((step % 16) + 1) / 16) * 100}%`
                              : "0%",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="track-stop">
                  <button
                    aria-label={`Stop ${t.name}`}
                    title="Stop track at next bar"
                    onClick={() => launch(t, -1)}
                    className={queued[t.id] === -1 ? "queued-stop" : ""}
                  >
                    <Square size={10} fill="currentColor" />
                  </button>
                  <span>{t.active >= 0 ? "1 bar" : "—"}</span>
                </div>
                <div className="mixer">
                  <div className="pan">
                    <span>L</span>
                    <input
                      aria-label={`${t.name} pan`}
                      type="range"
                      min="-1"
                      max="1"
                      step=".01"
                      value={t.pan}
                      onChange={(e) =>
                        updateTrack(t.id, { pan: +e.target.value })
                      }
                    />
                    <span>R</span>
                  </div>
                  <div className="fader-section">
                    <div className="fader-scale">
                      <span>0</span>
                      <span>−6</span>
                      <span>−12</span>
                      <span>−24</span>
                      <span>−∞</span>
                    </div>
                    <div className="fader">
                      <input
                        aria-label={`${t.name} volume`}
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={t.volume}
                        onChange={(e) =>
                          updateTrack(t.id, { volume: +e.target.value })
                        }
                      />
                    </div>
                    <div className="meter">
                      <i
                        style={{
                          height: `${(levels[t.id] || 0) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="volume-value">
                    {db(t.volume)} <span>dB</span>
                  </div>
                  <div className="mix-buttons">
                    <button
                      title={`Mute ${t.name}`}
                      aria-pressed={t.mute}
                      className={t.mute ? "mute-on" : ""}
                      onClick={() => updateTrack(t.id, { mute: !t.mute })}
                    >
                      M
                    </button>
                    <button
                      title={`Solo ${t.name}`}
                      aria-pressed={t.solo}
                      className={t.solo ? "solo-on" : ""}
                      onClick={() => updateTrack(t.id, { solo: !t.solo })}
                    >
                      S
                    </button>
                    <button
                      title={`Enable ${t.name}`}
                      aria-pressed={t.active >= 0}
                      className={t.active >= 0 ? "power-on" : ""}
                      onClick={() =>
                        launch(
                          t,
                          t.active >= 0 ? -1 : t.clips.findIndex(Boolean),
                        )
                      }
                    >
                      <Power size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="add-column">
              <button onClick={addTrack} aria-label="Add track">
                <Plus size={20} />
              </button>
            </div>
          </div>
        </div>
      </section>
      <section
        ref={editor}
        id="note-editor"
        className="device"
        style={{ "--track": track.color } as CSSProperties}
      >
        <div className="device-top">
          <div className="device-name">
            <i style={{ background: track.color }} />
            <span className="device-coordinate">
              {columnLabel(project.tracks.indexOf(track))}
              {tab === "pattern" ? clipIndex + 1 : ""}
            </span>
          </div>
          <div className="device-tabs">
            <button
              className={tab === "sound" ? "current" : ""}
              onClick={() => setTab("sound")}
            >
              <SlidersHorizontal size={13} />
              Sound
            </button>
            <button
              className={tab === "pattern" ? "current" : ""}
              onClick={() => setTab("pattern")}
            >
              <Music2 size={13} />
              Pattern
            </button>
          </div>
          <div className="device-tools">
            <button
              title="Duplicate track"
              aria-label="Duplicate track"
              onClick={() => {
                if (project.tracks.length >= 16) return;
                const t = {
                  ...structuredClone(track),
                  id: crypto.randomUUID(),
                  name: `${track.name.slice(0, 32)} copy`,
                  active: -1,
                };
                edit((p) => ({ ...p, tracks: [...p.tracks, t] }));
                setSelected(t.id);
              }}
            >
              <Copy size={13} />
            </button>
            <button
              title="Delete track"
              aria-label="Delete track"
              disabled={project.tracks.length === 1}
              onClick={() => {
                edit((p) => ({
                  ...p,
                  tracks: p.tracks.filter((t) => t.id !== track.id),
                }));
                setSelected(project.tracks.find((t) => t.id !== track.id)!.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {tab === "sound" ? (
          <div className="sound-editor">
            <div className="preset-panel">
              {(["Drums", "Synths"] as const).map((group) => (
                <div className="preset-group" key={group}>
                  <span>{group}</span>
                  <div>
                    {soundPresets
                      .filter((p) => p.group === group)
                      .map((p) => (
                        <button
                          key={p.name}
                          className={
                            Object.entries(p.sound).every(
                              ([k, v]) => track[k as keyof Track] === v,
                            )
                              ? "preset-selected"
                              : ""
                          }
                          onClick={() => updateTrack(track.id, p.sound)}
                        >
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            <SoundRecorder
              key={track.id}
              reconstruction={track.reconstruction}
              active={track.kind === "recorded"}
              playing={playing}
              onCaptureStatus={(capturing) => {
                microphoneActive.current = capturing;
              }}
              stopRevision={previewStopRevision}
              initialCapture={captures.current.get(track.id)}
              onCaptureChange={(capture) =>
                captures.current.set(track.id, capture)
              }
              onCaptureStart={stop}
              onApply={(reconstruction, samples) => {
                getEngine().cacheReconstruction(reconstruction, samples);
                updateTrack(
                  track.id,
                  {
                    kind: "recorded",
                    reconstruction,
                    ...(track.kind === "recorded" && track.reconstruction
                      ? {}
                      : {
                          frequency: reconstruction.referenceFrequency,
                          attack: 0.005,
                          decay: 0.1,
                          cutoff: 18000,
                        }),
                  },
                  false,
                );
              }}
            />
            <div className="oscillator">
              <div className="section-label">OSCILLATOR</div>
              <div className="wave-select">
                {waves.map((w) => (
                  <button
                    key={w}
                    title={w}
                    aria-label={`${w} wave`}
                    aria-pressed={track.kind !== "recorded" && track.wave === w}
                    className={
                      track.kind !== "recorded" && track.wave === w
                        ? "chosen"
                        : ""
                    }
                    onClick={() =>
                      updateTrack(track.id, {
                        wave: w,
                        kind: w === "noise" ? "hat" : "synth",
                      })
                    }
                  >
                    <Waveform
                      small
                      wave={w}
                      color={
                        track.kind !== "recorded" && track.wave === w
                          ? track.color
                          : "#777983"
                      }
                    />
                  </button>
                ))}
              </div>
              <div className="wave-display">
                {track.kind === "recorded" && track.reconstruction ? (
                  <ReconstructedWaveform
                    model={track.reconstruction}
                    color={track.color}
                  />
                ) : (
                  <Waveform wave={track.wave} color={track.color} />
                )}
                <span>
                  {track.kind === "recorded" ? "reconstructed" : track.wave}
                </span>
                <span>{track.frequency.toFixed(2)} Hz</span>
              </div>
              <Control
                label="Frequency"
                value={track.frequency}
                min={20}
                max={2000}
                step={0.01}
                display={`${track.frequency.toFixed(2)} Hz`}
                onChange={(frequency) => updateTrack(track.id, { frequency })}
              />
              <div
                className="note-shortcuts"
                aria-label="Common note frequencies"
              >
                {noteShortcuts.map((note) => (
                  <button
                    key={note.name}
                    aria-label={`Set ${note.name}, ${note.frequency} Hz`}
                    aria-pressed={
                      Math.abs(track.frequency - note.frequency) < 0.005
                    }
                    onClick={() =>
                      updateTrack(track.id, { frequency: note.frequency })
                    }
                  >
                    <b>{note.name}</b>
                    <span>{note.frequency} Hz</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="envelope">
              <div className="section-label">SHAPE</div>
              <Control
                label="Attack"
                value={track.attack}
                min={0.001}
                max={2}
                step={0.001}
                display={`${Math.round(track.attack * 1000)} ms`}
                onChange={(attack) => updateTrack(track.id, { attack })}
              />
              <Control
                label="Decay"
                value={track.decay}
                min={0.03}
                max={3}
                display={`${Math.round(track.decay * 1000)} ms`}
                onChange={(decay) => updateTrack(track.id, { decay })}
              />
              <Control
                label="Filter"
                value={track.cutoff}
                min={80}
                max={18000}
                step={10}
                display={`${(track.cutoff / 1000).toFixed(2)} kHz`}
                onChange={(cutoff) => updateTrack(track.id, { cutoff })}
              />
            </div>
            <div className="effects">
              <div className="section-label">
                EFFECTS <span className="effect-dot" />
              </div>
              <Control
                label="Reverb"
                value={track.reverb}
                min={0}
                max={1}
                display={`${Math.round(track.reverb * 100)}%`}
                onChange={(reverb) => updateTrack(track.id, { reverb })}
              />
              <Control
                label="Echo"
                value={track.echo}
                min={0}
                max={0.8}
                display={`${Math.round(track.echo * 100)}%`}
                onChange={(echo) => updateTrack(track.id, { echo })}
              />
              <div className="echo-time">
                <span>Sync</span>
                <b>3/16</b>
                <span>Feedback</span>
                <b>32%</b>
              </div>
            </div>
            <div className="compressor">
              <div className="section-label">
                COMPRESSOR <span className="tiny-badge">MASTER</span>
              </div>
              <div className="compressor-graph">
                <div className="compressor-line" />
                <span>4:1</span>
              </div>
              <Control
                label="Threshold"
                value={project.compressor}
                min={-60}
                max={0}
                step={1}
                display={`${project.compressor} dB`}
                onChange={(compressor) => {
                  edit((p) => ({ ...p, compressor }));
                  scheduleSoundPreview(track.id);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="pattern-editor">
            <div className="pattern-toolbar">
              <span>1 bar · 1/16</span>
              <button
                onClick={copyPattern}
                disabled={!clip?.notes.length}
                title="Copy all notes · Ctrl/⌘ C"
              >
                <Copy size={12} />
                Copy
              </button>
              <button
                onClick={pastePattern}
                disabled={!clipboard}
                title="Paste notes · Ctrl/⌘ V"
              >
                <ClipboardPaste size={12} />
                Paste
              </button>
              <button
                onClick={() => updateNotes([])}
                disabled={!clip?.notes.length}
              >
                Clear
              </button>
            </div>
            <PianoRoll
              key={track.id + ":" + clipIndex}
              notes={clip?.notes ?? []}
              revision={historyRevision}
              onChange={updateNotes}
              onPreview={previewPitch}
              frequency={track.frequency}
              step={playing && track.active === clipIndex ? step : -1}
            />
          </div>
        )}
      </section>
      <button
        className="scroll-toggle"
        onClick={toggleScroll}
        aria-label={atEditor ? "Scroll to top of app" : "Scroll to note editor"}
        aria-controls="note-editor"
      >
        {atEditor ? <ArrowUp size={15} /> : <ArrowDown size={15} />}{" "}
        {atEditor ? "Top" : "Notes"}
      </button>
      <footer>
        <span>
          <i className={playing ? "status-dot green" : "status-dot"} />
          {finishing
            ? "Finishing recording"
            : recording
              ? "Recording"
              : playing
                ? "Playing"
                : "Stopped"}
          <span className="footer-separator">/</span>
          {project.tracks.length} tracks
          <span className="footer-separator">/</span>
          {activeCount} active
        </span>
        <span>
          {Object.keys(queued).length > 0
            ? "Launch queued for next bar"
            : recording
              ? clock(seconds)
              : "Space to play / stop"}
          <span className="footer-separator">·</span>
          <span className="footer-local">Local audio</span>
        </span>
      </footer>
      {message && (
        <div className="toast" role="status">
          <Check size={14} />
          {message}
        </div>
      )}
      {showTempo && (
        <div className="modal-backdrop" onClick={closeTempo}>
          <form
            className="tempo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tempo-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              applyTempo();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const items = e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input",
              );
              const first = items[0],
                last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="dialog-header">
              <h2 id="tempo-title">Tempo</h2>
              <button
                type="button"
                aria-label="Close tempo"
                onClick={closeTempo}
              >
                <X size={18} />
              </button>
            </div>
            <label className="tempo-field">
              <input
                aria-label="BPM"
                type="text"
                inputMode="decimal"
                autoFocus
                maxLength={7}
                value={bpmDraft}
                aria-invalid={!!bpmError}
                aria-describedby={bpmError ? "bpm-error" : undefined}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setBpmDraft(e.target.value);
                  setBpmError("");
                }}
              />
              <span>BPM</span>
            </label>
            <div className="tempo-steps">
              <button
                type="button"
                onClick={() => {
                  setBpmDraft(stepBpm(bpmDraft, project.bpm, -10));
                  setBpmError("");
                }}
              >
                −10 BPM
              </button>
              <button
                type="button"
                onClick={() => {
                  setBpmDraft(stepBpm(bpmDraft, project.bpm, 10));
                  setBpmError("");
                }}
              >
                +10 BPM
              </button>
            </div>
            {bpmError && (
              <p id="bpm-error" role="alert" className="tempo-error">
                {bpmError}
              </p>
            )}
            <div className="dialog-buttons">
              <button type="button" onClick={closeTempo}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Apply
              </button>
            </div>
          </form>
        </div>
      )}
      {showRecord && (
        <div className="modal-backdrop" onClick={() => setShowRecord(false)}>
          <section
            className="record-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Session recording"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Session recording</h2>
              <button
                aria-label="Close recording"
                onClick={() => setShowRecord(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className={`record-time ${recording ? "red" : ""}`}>
              <Circle size={12} fill="currentColor" />
              {clock(seconds)}
            </div>
            <p>
              {finishing
                ? playing
                  ? "Waiting for patterns to finish…"
                  : "Waiting for reverb and echoes to become quiet…"
                : recording
                  ? "Capturing the master output."
                  : encoding
                    ? "Encoding MP3…"
                    : take
                      ? "Your recording is ready."
                      : "Use Record to capture a session."}
            </p>
            <div className="dialog-buttons">
              <button
                disabled={!take || recording || encoding || sharing}
                onClick={() => void shareRecording()}
              >
                <Share2 size={14} />
                {sharing ? "Sharing…" : "Share"}
              </button>
              <button
                className="primary"
                disabled={!take || recording || encoding}
                onClick={() => take && download(take, `${project.name}.mp3`)}
              >
                <Download size={14} />
                Export MP3
              </button>
            </div>
            {shareStatus && (
              <p className="share-status" role="status">
                {shareStatus}
              </p>
            )}
            {take && !recording && <audio controls src={takeUrl} />}
          </section>
        </div>
      )}
    </main>
  );
}
