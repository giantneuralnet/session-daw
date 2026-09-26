"use client";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  Play,
  ArrowDown,
  ArrowUp,
  Undo2,
  Redo2,
  ClipboardPaste,
  Square,
  Circle,
  Plus,
  FolderOpen,
  Download,
  Headphones,
  SlidersHorizontal,
  AudioLines,
  Trash2,
  Copy,
  X,
  Check,
  Power,
  Music2,
} from "lucide-react";
import { History } from "../lib/history";
import { pasteNotes } from "../lib/piano-roll";
import { PianoRoll } from "./PianoRoll";
import { AudioEngine } from "../lib/audio";
import {
  initialProject,
  emptyProject,
  addRow,
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
    [take, setTake] = useState<Blob | null>(null),
    [seconds, setSeconds] = useState(0),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState<"sound" | "pattern">("sound"),
    [levels, setLevels] = useState<Record<string, number>>({}),
    [showRecord, setShowRecord] = useState(false),
    [takeUrl, setTakeUrl] = useState(""),
    [atEditor, setAtEditor] = useState(false),
    [historyRevision, setHistoryRevision] = useState(0),
    [clipboard, setClipboard] = useState<Note[] | null>(null);
  const history = useRef(new History<Project>()),
    state = useRef(project),
    engine = useRef<AudioEngine | null>(null),
    file = useRef<HTMLInputElement>(null),
    editor = useRef<HTMLElement>(null),
    recordStart = useRef(0),
    recordBusy = useRef(false);
  state.current = project;
  const track =
      project.tracks.find((t) => t.id === selected) || project.tracks[0],
    clip = track.clips[clipIndex];
  function edit(fn: (p: Project) => Project, remember = true) {
    const next = fn(state.current);
    if (remember && history.current.commit(state.current, next))
      setHistoryRevision((v) => v + 1);
    state.current = next;
    setProject(next);
  }
  function updateTrack(id: string, patch: Partial<Track>) {
    edit(
      (p) => ({
        ...p,
        tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }),
      Object.keys(patch).some((key) => key !== "active"),
    );
  }
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
    if (!playing) {
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
  }, [playing]);
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
      e.onRecorded = (blob) => {
        setTake(blob);
        setEncoding(false);
        setMessage("Recording ready to export");
      };
      e.onError = (m) => {
        setMessage(m);
        setEncoding(false);
        setRecording(false);
        e.endRecording();
      };
      engine.current = e;
    }
    return engine.current;
  }
  async function play() {
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
    engine.current?.stop();
    setPlaying(false);
    setStep(-1);
    setQueued({});
    if (recording) finishRecording();
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
    if (recordBusy.current) return;
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
      setShowRecord(true);
      if (!playing) await play();
    } catch {
      setMessage("Recording is unavailable. Try a current browser over HTTPS.");
    } finally {
      recordBusy.current = false;
    }
  }
  function finishRecording() {
    engine.current?.endRecording();
    setRecording(false);
    setEncoding(true);
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
      if (f.size > 1024 * 1024) throw Error("Session file is too large.");
      const p = parseProject(await f.text());
      stop();
      edit(() => p);
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
              aria-label={recording ? "Stop recording" : "Record session"}
              title="Record session"
              className={recording ? "record is-recording" : "record"}
              disabled={encoding}
              onClick={() => void record()}
            >
              <Circle size={14} fill="currentColor" />
            </button>
          </div>
          <div className="tempo">
            <input
              aria-label="Tempo"
              type="number"
              min="40"
              max="240"
              value={project.bpm}
              onChange={(e) => {
                const v = +e.target.value;
                if (v >= 40 && v <= 240) edit((p) => ({ ...p, bpm: v }));
              }}
            />
            <span>BPM</span>
          </div>
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
              take ? download(take, `${project.name}.mp3`) : setShowRecord(true)
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
              <div className="row-label-spacer" />
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
                <button
                  className="track-header"
                  onClick={() => {
                    setSelected(t.id);
                    setTab("sound");
                  }}
                >
                  <span>{columnLabel(i)}</span>
                </button>
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
      <div className="row-actions">
        <button
          onClick={() => edit(addRow)}
          disabled={project.tracks[0].clips.length >= 64}
        >
          <Plus size={13} />
          Add row
        </button>
      </div>
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
            <div className="oscillator">
              <div className="section-label">
                OSCILLATOR{" "}
                <button
                  title="Preview sound"
                  aria-label="Preview sound"
                  onClick={() => void getEngine().preview(track)}
                >
                  <Headphones size={13} />
                </button>
              </div>
              <div className="wave-select">
                {waves.map((w) => (
                  <button
                    key={w}
                    title={w}
                    aria-label={`${w} wave`}
                    aria-pressed={track.wave === w}
                    className={track.wave === w ? "chosen" : ""}
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
                      color={track.wave === w ? track.color : "#777983"}
                    />
                  </button>
                ))}
              </div>
              <div className="wave-display">
                <Waveform wave={track.wave} color={track.color} />
                <span>{track.wave}</span>
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
                onChange={(compressor) => edit((p) => ({ ...p, compressor }))}
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
          {recording ? "Recording" : playing ? "Playing" : "Stopped"}
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
              {recording
                ? "Capturing the master output."
                : encoding
                  ? "Encoding MP3…"
                  : take
                    ? "Your recording is ready."
                    : "Record your live clip performance and mix."}
            </p>
            <div className="dialog-buttons">
              <button disabled={encoding} onClick={() => void record()}>
                {recording ? <Square size={13} /> : <Circle size={13} />}{" "}
                {recording
                  ? "Stop recording"
                  : take
                    ? "New recording"
                    : "Start recording"}
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
            {take && !recording && <audio controls src={takeUrl} />}
          </section>
        </div>
      )}
    </main>
  );
}
