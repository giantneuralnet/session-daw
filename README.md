# Session

A minimal browser DAW. Synthesizers run locally with Web Audio. Each track has four one-bar clips with 16 steps. Clip launches and stops quantize to the next bar while the transport runs. Space starts/stops the transport.

Select Sound to edit wave shape, frequency, envelope, filter, reverb, and echo. Select Pattern to edit clip notes and pitches. Add tracks, duplicate tracks, or click empty slots to create clips. M and S control mute and solo. The master includes a 4:1 compressor.

Save downloads a versioned JSON description of the project: oscillators, pitches, patterns, effects and mixer settings. Open validates and restores that file. There are no stored waveform samples and no server-side audio storage.

Record captures the live stereo master using AudioWorklet and encodes in a separate worker. Stop recording to preview or download a 192 kbps MP3. Recording requires a modern browser and HTTPS (or localhost). Keep the tab active for reliable scheduling. Unsaved projects and recordings live only in this tab; save JSON and export recordings before closing it.

## Development

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run typecheck`

The MP3 encoder is the unmodified `@breezystack/lamejs` module copied to `public/audio/lamejs.js`. Its LGPL-3.0 license is provided alongside it. The encoder can be replaced independently with another module exporting the same `Mp3Encoder` interface. Source: https://github.com/shijinyu/lamejs
