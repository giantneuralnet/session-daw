import type { Project, Track } from "./session";
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
  previewStop?: () => void;
  previewSerial = 0;
  onRecorded: (blob: Blob) => void = () => {};
  onError: (message: string) => void = () => {};
  constructor(project: Project) {
    this.project = project;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.ratio.value = 4;
    this.compressor.knee.value = 18;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
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
        analyser.fftSize = 256;
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
    await this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }
  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
    for (const c of this.channels.values())
      c.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
  }
  queue(id: string, clip: number) {
    this.pending.set(id, clip);
  }
  tick() {
    if (!this.playing) return;
    if (this.next < this.ctx.currentTime - 0.2)
      this.next = this.ctx.currentTime + 0.03;
    while (this.next < this.ctx.currentTime + 0.1) {
      if (this.step % 16 === 0)
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
          if (n.start === this.step % 16)
            this.note(
              t,
              n.pitch,
              this.next,
              (n.length * 60) / this.project.bpm / 4,
            );
        }
      }
      this.onStep(this.step, this.next);
      this.step++;
      this.next += 60 / this.project.bpm / 4;
    }
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
    const hold = t.kind === "synth" ? Math.max(gate, t.attack) : t.attack;
    const duration = hold + t.decay + 0.03;
    if (t.wave === "noise") {
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
      const frequency = t.frequency * Math.pow(2, n / 12);
      s.frequency.setValueAtTime(
        t.kind === "kick" ? frequency * 3 : frequency,
        time,
      );
      if (t.kind === "kick")
        s.frequency.exponentialRampToValueAtTime(frequency, time + 0.08);
      source = s;
    }
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(
      t.kind === "kick" ? 0.9 : 0.3,
      time + t.attack,
    );
    env.gain.setValueAtTime(t.kind === "kick" ? 0.9 : 0.3, time + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(preview ? this.ctx.destination : c.input);
    if (preview) {
      this.previewStop?.();
      this.previewStop = () => {
        env.gain.cancelScheduledValues(this.ctx.currentTime);
        env.gain.setTargetAtTime(0, this.ctx.currentTime, 0.005);
        source.stop(this.ctx.currentTime + 0.025);
      };
    }
    source.start(time);
    source.stop(time + duration + 0.01);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
  async preview(t: Track, pitch = 0) {
    const serial = ++this.previewSerial;
    await this.ctx.resume();
    if (serial !== this.previewSerial) return;
    this.note(t, pitch, this.ctx.currentTime + 0.02, 0.1, true);
  }
  async record() {
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
      this.recorder?.port.postMessage("stop");
    }
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.worker?.terminate();
    void this.ctx.close();
  }
}
