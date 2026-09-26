class SessionRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.recording = false; this.port.onmessage = ({data}) => { this.recording = data === 'start'; if (data === 'stop') this.port.postMessage({done:true}); }; }
  process(inputs) { const input = inputs[0]; if(this.recording && input?.[0]) { const left = new Float32Array(input[0]); const right = new Float32Array(input[1] || input[0]); this.port.postMessage({left,right}, [left.buffer,right.buffer]); } return true; }
}
registerProcessor('session-recorder', SessionRecorder);
