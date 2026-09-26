class MicrophoneCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.length = 0;
    this.port.onmessage = ({ data }) => { if (data === "stop") this.finish(); };
  }
  finish() {
    if (!this.active) return;
    this.active = false;
    this.port.postMessage({ done: true });
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    const length = Math.min(channels[0].length, Math.round(sampleRate * 5) - this.length);
    const samples = new Float32Array(length);
    for (const channel of channels)
      for (let i = 0; i < length; i++) samples[i] += channel[i] / channels.length;
    this.length += length;
    this.port.postMessage({ samples }, [samples.buffer]);
    if (this.length >= Math.round(sampleRate * 5)) this.finish();
    return true; // Output stays silent: never monitor the microphone.
  }
}
registerProcessor("instrument-microphone", MicrophoneCapture);
