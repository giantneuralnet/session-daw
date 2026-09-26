import { Mp3Encoder } from './lamejs.js';
let encoder, chunks = [];
const pcm = a => Int16Array.from(a, n => Math.max(-1, Math.min(1,n)) * (n < 0 ? 32768 : 32767));
self.onmessage = ({data}) => { try { if(data.start) { encoder = new Mp3Encoder(2, data.sampleRate, 192); chunks = []; }
else if(data.done) { const last = encoder.flush(); if(last.length) chunks.push(new Uint8Array(last)); self.postMessage({blob:new Blob(chunks,{type:'audio/mpeg'})}); chunks=[]; }
else { const bytes = encoder.encodeBuffer(pcm(data.left),pcm(data.right)); if(bytes.length) chunks.push(new Uint8Array(bytes)); }
} catch(e) { self.postMessage({error:String(e)}); } };
