import { TailMonitor } from "./tail-monitor.ts";
import { prepareAudioPlayback } from "./audio-session.ts";
import { renderedSound, type Reconstruction } from "./resynthesis.ts";
import { stepsPerBar, type Project, type Track } from "./session.ts";
type Channel = {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  wet: GainNode;
  echo: GainNode;
  delay: DelayNode;
  analyser: AnalyserNode;
  nodes: AudioNode[];
};
export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  channels = new Map<string, Channel>();
  project: Project;
  playing = false;
  next = 0;
  step = 0;
  timer: ReturnType<typeof setInterval> | null = null;
  pending = new Map<string, number>();
  onStep: (step: number, time: number) => void = () => {};
  onLaunch: (id: string, clip: number) => void = () => {};
  recorder?: AudioWorkletNode;
  worker?: Worker;
  recording = false;
  finishing = false;
  stopAtStep: number | null = null;
  tailTimer: ReturnType<typeof setInterval> | null = null;
  lastVoiceEnd = 0;
  voices = new Set<() => void>();
  onStopped: () => void = () => {};
  onRecordingFinalizing: () => void = () => {};
  previewStop?: () => void;
  previewSerial = 0;
  reconstructedBuffers = new WeakMap<Reconstruction, AudioBuffer>();
  previewBus?: {
    input: GainNode;
    gain: GainNode;
    pan: StereoPannerNode;
    wet: GainNode;
    echo: GainNode;
    delay: DelayNode;
    compressor: DynamicsCompressorNode;
    nodes: AudioNode[];
  };
  onRecorded: (blob: Blob) => void = () => {};
  onError: (message: string) => void = () => {};
  constructor(project: Project) {
    this.project = project;
    prepareAudioPlayback();
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.ratio.value = 4;
    this.compressor.knee.value = 18;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.compressor.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.update(project);
  }
  update(p: Project) {
    this.project = p;
    const solo = p.tracks.some((t) => t.solo);
    this.master.gain.setTargetAtTime(p.master, this.ctx.currentTime, 0.02);
    this.compressor.threshold.value = p.compressor;
    for (const [id, c] of this.channels)
      if (!p.tracks.some((t) => t.id === id)) {
        c.nodes.forEach((n) => n.disconnect());
        this.channels.delete(id);
        this.pending.delete(id);
      }
    for (const t of p.tracks) {
      if (
        t.kind === "recorded" &&
        t.reconstruction &&
        !this.reconstructedBuffers.has(t.reconstruction)
      )
        this.cacheReconstruction(t.reconstruction);
      let c = this.channels.get(t.id);
      if (!c) {
        const input = this.ctx.createGain(),
          gain = this.ctx.createGain(),
          pan = this.ctx.createStereoPanner(),
          wet = this.ctx.createGain(),
          echo = this.ctx.createGain(),
          delay = this.ctx.createDelay(2),
          feedback = this.ctx.createGain(),
          verb = this.ctx.createConvolver();
        const impulse = this.ctx.createBuffer(
          2,
          this.ctx.sampleRate * 1.8,
          this.ctx.sampleRate,
        );
        for (let ch = 0; ch < 2; ch++) {
          const a = impulse.getChannelData(ch);
          for (let i = 0; i < a.length; i++)
            a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 2.8);
        }
        verb.buffer = impulse;
        feedback.gain.value = 0.32;
        input.connect(gain);
        input.connect(verb);
        verb.connect(wet);
        wet.connect(gain);
        input.connect(delay);
        delay.connect(echo);
        echo.connect(gain);
        delay.connect(feedback);
        feedback.connect(delay);
        gain.connect(pan);
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 2048;
        pan.connect(analyser);
        analyser.connect(this.compressor);
        c = {
          input,
          gain,
          pan,
          wet,
          echo,
          delay,
          analyser,
          nodes: [input, gain, pan, wet, echo, delay, feedback, verb, analyser],
        };
        this.channels.set(t.id, c);
      }
      c.gain.gain.setTargetAtTime(
        t.mute || (solo && !t.solo) ? 0 : t.volume,
        this.ctx.currentTime,
        0.01,
      );
      c.pan.pan.value = t.pan;
      c.wet.gain.value = t.reverb * 0.6;
      c.echo.gain.value = t.echo;
      c.delay.delayTime.setTargetAtTime(
        (60 / p.bpm) * 0.75,
        this.ctx.currentTime,
        0.03,
      );
    }
  }
  async start() {
    prepareAudioPlayback();
    await this.ctx.resume();
    if (this.playing || this.finishing) return;
    this.clearPreview();
    this.playing = true;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }
  stop(immediate = true) {
    this.playing = false;
    this.stopAtStep = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    if (immediate) {
      for (const stopVoice of this.voices) stopVoice();
      this.clearPreview();
      this.lastVoiceEnd = this.ctx.currentTime + 0.03;
    }
    this.project = {
      ...this.project,
      tracks: this.project.tracks.map((t) => ({ ...t, active: -1 })),
    };
    this.onStopped();
  }
  stopAtBarEnd() {
    this.pending.clear();
    if (!this.playing) {
      this.clearPreview();
      return;
    }
    const steps = stepsPerBar(this.project);
    this.stopAtStep ??= Math.max(steps, Math.ceil(this.step / steps) * steps);
  }
  finishRecording() {
    if (!this.recording || this.finishing) return;
    this.finishing = true;
    this.stopAtBarEnd();
    const monitor = new TailMonitor();
    const samples = new Float32Array(2048);
    this.tailTimer = setInterval(() => {
      let peak = 0;
      for (const analyser of [
        this.analyser,
        ...Array.from(this.channels.values(), (c) => c.analyser),
      ]) {
        analyser.getFloatTimeDomainData(samples);
        for (const v of samples) peak = Math.max(peak, Math.abs(v));
      }
      if (
        monitor.update(
          this.ctx.currentTime,
          peak,
          !this.playing && this.ctx.currentTime >= this.lastVoiceEnd,
        )
      ) {
        if (this.tailTimer) clearInterval(this.tailTimer);
        this.tailTimer = null;
        this.endRecording();
        this.onRecordingFinalizing();
      }
    }, 50);
  }
  queue(id: string, clip: number) {
    if (!this.finishing && this.stopAtStep === null) this.pending.set(id, clip);
  }
  tick() {
    if (!this.playing) return;
    if (this.next < this.ctx.currentTime - 0.2)
      this.next = this.ctx.currentTime + 0.03;
    while (this.next < this.ctx.currentTime + 0.1) {
      if (this.stopAtStep !== null && this.step >= this.stopAtStep) {
        if (this.ctx.currentTime >= this.next) this.stop(false);
        return;
      }
      const steps = stepsPerBar(this.project);
      if (this.step % steps === 0)
        for (const [id, clip] of this.pending) {
          const t = this.project.tracks.find((x) => x.id === id);
          if (t) {
            this.project = {
              ...this.project,
              tracks: this.project.tracks.map((x) =>
                x.id === id ? { ...x, active: clip } : x,
              ),
            };
            this.onLaunch(id, clip);
          }
          this.pending.delete(id);
        }
      for (const t of this.project.tracks) {
        for (const n of t.clips[t.active]?.notes ?? []) {
          if (n.start === this.step % steps)
            this.note(
              t,
              n.pitch,
              this.next,
              (Math.min(n.length, steps - n.start) * 60) / this.project.bpm / 4,
            );
        }
      }
      this.onStep(this.step, this.next);
      this.step++;
      this.next += 60 / this.project.bpm / 4;
    }
  }
  clearPreview() {
    this.previewSerial++;
    this.previewStop?.();
    this.previewStop = undefined;
    this.previewBus?.nodes.forEach((node) => node.disconnect());
    this.previewBus = undefined;
  }
  previewDestination(t: Track) {
    if (!this.previewBus) {
      const input = this.ctx.createGain(),
        gain = this.ctx.createGain(),
        pan = this.ctx.createStereoPanner(),
        wet = this.ctx.createGain(),
        echo = this.ctx.createGain(),
        delay = this.ctx.createDelay(2),
        feedback = this.ctx.createGain(),
        verb = this.ctx.createConvolver(),
        compressor = this.ctx.createDynamicsCompressor();
      const impulse = this.ctx.createBuffer(
        2,
        this.ctx.sampleRate * 1.8,
        this.ctx.sampleRate,
      );
      for (let ch = 0; ch < 2; ch++) {
        const samples = impulse.getChannelData(ch);
        for (let i = 0; i < samples.length; i++)
          samples[i] =
            (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 2.8);
      }
      verb.buffer = impulse;
      feedback.gain.value = 0.32;
      input.connect(gain);
      input.connect(verb);
      verb.connect(wet);
      wet.connect(gain);
      input.connect(delay);
      delay.connect(echo);
      echo.connect(gain);
      delay.connect(feedback);
      feedback.connect(delay);
      gain.connect(pan);
      pan.connect(compressor);
      compressor.connect(this.ctx.destination);
      compressor.ratio.value = 4;
      compressor.knee.value = 18;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      this.previewBus = {
        input,
        gain,
        pan,
        wet,
        echo,
        delay,
        compressor,
        nodes: [input, gain, pan, wet, echo, delay, feedback, verb, compressor],
      };
    }
    const b = this.previewBus;
    b.gain.gain.value = t.volume;
    b.pan.pan.value = t.pan;
    b.wet.gain.value = t.reverb * 0.6;
    b.echo.gain.value = t.echo;
    b.delay.delayTime.value = (60 / this.project.bpm) * 0.75;
    b.compressor.threshold.value = this.project.compressor;
    return b.input;
  }
  cacheReconstruction(model: Reconstruction, samples = renderedSound(model)) {
    const buffer = this.ctx.createBuffer(1, samples.length, model.sampleRate);
    buffer.getChannelData(0).set(samples);
    this.reconstructedBuffers.set(model, buffer);
    return buffer;
  }
  note(t: Track, n: number, time: number, gate = 0.125, preview = false) {
    const c = this.channels.get(t.id);
    if (!c) return;
    const env = this.ctx.createGain(),
      filter = this.ctx.createBiquadFilter();
    filter.type = t.kind === "hat" ? "highpass" : "lowpass";
    filter.frequency.value = t.cutoff;
    filter.Q.value = 0.7;
    let source: OscillatorNode | AudioBufferSourceNode;
    let hold =
      t.kind === "synth" || t.kind === "recorded"
        ? Math.max(gate, t.attack)
        : t.attack;
    let duration = hold + t.decay + 0.03;
    if (t.kind === "recorded" && t.reconstruction) {
      const model = t.reconstruction;
      const s = this.ctx.createBufferSource();
      s.buffer =
        this.reconstructedBuffers.get(model) ?? this.cacheReconstruction(model);
      const rate = Math.max(
        0.01,
        Math.min(
          64,
          (t.frequency / model.referenceFrequency) * Math.pow(2, n / 12),
        ),
      );
      s.playbackRate.value = rate;
      const fullDuration = model.length / model.sampleRate / rate;
      duration = preview ? fullDuration : Math.min(duration, fullDuration);
      hold = Math.min(hold, Math.max(0.001, duration - 0.01));
      if (preview) hold = Math.max(0.001, duration - Math.max(0.01, t.decay));
      source = s;
    } else if (t.wave === "noise") {
      const b = this.ctx.createBuffer(
          1,
          Math.ceil(this.ctx.sampleRate * duration),
          this.ctx.sampleRate,
        ),
        a = b.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      source = s;
    } else {
      const s = this.ctx.createOscillator();
      s.type = t.wave;
      const frequency = Math.min(
        this.ctx.sampleRate * 0.45,
        t.frequency * Math.pow(2, n / 12),
      );
      s.frequency.setValueAtTime(
        t.kind === "kick" ? frequency * 3 : frequency,
        time,
      );
      if (t.kind === "kick")
        s.frequency.exponentialRampToValueAtTime(frequency, time + 0.08);
      source = s;
    }
    env.gain.setValueAtTime(0.0001, time);
    const level = t.kind === "kick" ? 0.9 : t.kind === "recorded" ? 0.8 : 0.3;
    env.gain.linearRampToValueAtTime(level, time + Math.min(t.attack, hold));
    env.gain.setValueAtTime(level, time + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(preview ? this.previewDestination(t) : c.input);
    if (preview) {
      this.previewStop?.();
      this.previewStop = () => {
        env.gain.cancelScheduledValues(this.ctx.currentTime);
        env.gain.setTargetAtTime(0, this.ctx.currentTime, 0.005);
        source.stop(this.ctx.currentTime + 0.025);
      };
    }
    const stopVoice = () => {
      env.gain.cancelScheduledValues(this.ctx.currentTime);
      env.gain.setTargetAtTime(0, this.ctx.currentTime, 0.005);
      source.stop(this.ctx.currentTime + 0.025);
    };
    this.voices.add(stopVoice);
    if (!preview)
      this.lastVoiceEnd = Math.max(this.lastVoiceEnd, time + duration + 0.01);
    source.start(time);
    source.stop(time + duration + 0.01);
    source.onended = () => {
      this.voices.delete(stopVoice);
      source.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
  async preview(t: Track, pitch = 0, onlyStopped = false) {
    if (onlyStopped && (this.playing || this.finishing)) return;
    const serial = ++this.previewSerial;
    prepareAudioPlayback();
    await this.ctx.resume();
    if (
      serial !== this.previewSerial ||
      (onlyStopped && (this.playing || this.finishing))
    )
      return;
    this.note(t, pitch, this.ctx.currentTime + 0.02, 0.1, true);
  }
  async record() {
    if (this.recording || this.finishing) return;
    prepareAudioPlayback();
    await this.ctx.resume();
    if (!this.recorder) {
      await this.ctx.audioWorklet.addModule("/audio/recorder.js");
      this.recorder = new AudioWorkletNode(this.ctx, "session-recorder");
      this.master.connect(this.recorder);
      this.recorder.connect(this.ctx.destination);
    }
    this.worker?.terminate();
    this.worker = new Worker("/audio/encoder.js", { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.error)
        this.onError("Recording could not be encoded. Please try again.");
      else this.onRecorded(data.blob);
    };
    this.worker.onerror = () =>
      this.onError("MP3 encoder could not start. Please try again.");
    this.worker.postMessage({ start: true, sampleRate: this.ctx.sampleRate });
    this.recorder.port.onmessage = ({ data }) => {
      this.worker?.postMessage(data);
    };
    this.recording = true;
    this.recorder.port.postMessage("start");
  }
  endRecording() {
    if (this.recording) {
      this.recording = false;
      this.finishing = false;
      if (this.tailTimer) clearInterval(this.tailTimer);
      this.tailTimer = null;
      this.recorder?.port.postMessage("stop");
    }
  }
  dispose() {
    if (this.tailTimer) clearInterval(this.tailTimer);
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.worker?.terminate();
    void this.ctx.close();
  }
}
