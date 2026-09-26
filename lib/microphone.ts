import { MAX_SECONDS, SAMPLE_RATE } from "./resynthesis.ts";

export class MicrophoneRecording {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private timer?: ReturnType<typeof setTimeout>;
  private chunks: Float32Array[] = [];
  private length = 0;
  private reported = 0;
  private peak = 0;
  private cancelled = false;
  private finished = false;
  onProgress: (seconds: number, peak: number) => void = () => {};
  onComplete: (samples: Float32Array) => void = () => {};
  onError: (message: string) => void = () => {};

  async start() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error("Microphone recording is unavailable in this browser.");
    const ctx = (this.context = new AudioContext());
    await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (this.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    await ctx.audioWorklet.addModule("/audio/microphone.js");
    if (this.cancelled) return;
    this.worklet = new AudioWorkletNode(ctx, "instrument-microphone");
    this.source = ctx.createMediaStreamSource(stream);
    this.worklet.port.onmessage = ({ data }) => {
      if (this.cancelled || this.finished) return;
      if (data.done) {
        void this.finish();
        return;
      }
      const chunk = data.samples as Float32Array;
      this.chunks.push(chunk);
      this.length += chunk.length;
      let peak = 0;
      for (const sample of chunk) peak = Math.max(peak, Math.abs(sample));
      this.peak = Math.max(this.peak, peak);
      if (this.length - this.reported >= ctx.sampleRate / 20) {
        this.onProgress(this.length / ctx.sampleRate, this.peak);
        this.reported = this.length;
        this.peak = 0;
      }
    };
    this.source.connect(this.worklet);
    this.worklet.connect(ctx.destination);
    this.timer = setTimeout(() => this.stop(), MAX_SECONDS * 1000 + 100);
    stream
      .getAudioTracks()
      .forEach((t) =>
        t.addEventListener("ended", () => this.stop(), { once: true }),
      );
  }
  stop() {
    this.worklet?.port.postMessage("stop");
  }
  private release() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.worklet?.disconnect();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
  }
  private async finish() {
    this.finished = true;
    const rate = this.context!.sampleRate;
    this.release();
    try {
      if (this.length < rate * 0.08)
        throw Error("Record a sound for at least 0.1 seconds.");
      const pcm = new Float32Array(this.length);
      let offset = 0;
      for (const chunk of this.chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      this.chunks = [];
      // Native offline resampling includes anti-alias filtering before analysis.
      const offline = new OfflineAudioContext(
        1,
        Math.min(
          SAMPLE_RATE * MAX_SECONDS,
          Math.round((this.length * SAMPLE_RATE) / rate),
        ),
        SAMPLE_RATE,
      );
      const buffer = offline.createBuffer(1, pcm.length, rate);
      buffer.getChannelData(0).set(pcm);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const result = await offline.startRendering();
      if (!this.cancelled) this.onComplete(result.getChannelData(0).slice());
    } catch (error) {
      if (!this.cancelled)
        this.onError(
          error instanceof Error
            ? error.message
            : "Could not read the recording.",
        );
    }
  }
  dispose() {
    this.cancelled = true;
    this.release();
    this.chunks = [];
  }
}

export function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was denied. Allow microphone access in your browser and try again.";
  if (name === "NotFoundError")
    return "No microphone found. Connect a microphone and try again.";
  if (name === "NotReadableError")
    return "The microphone is busy. Close other recording apps and try again.";
  return error instanceof Error
    ? error.message
    : "Could not start the microphone. Try again.";
}
