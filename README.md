# Session

A minimal browser DAW. Synthesizers run locally with Web Audio. Columns are identified by letters and rows by numbers. Each clip is one bar with a 16-step time grid and 25 pitch rows. Add row extends the session grid up to 64 rows. Clip launches and stops quantize to the next bar while the transport runs. Space starts/stops the transport.

Select Sound to edit wave shape, frequency, envelope, filter, reverb, and echo. Click a filled clip to select it for editing and start playback. While playing, click again to queue its stop on the next bar. Empty cells create new patterns. Drag empty space horizontally to draw a note and set its length; tap an existing note to erase it; drag notes to move them in time or pitch. Pitch changes play a short preview. Notes can overlap at different pitches for chords. Arrow keys move the editing cursor, Enter toggles a note, Delete erases, and Shift+arrows resize or transpose. Add columns with +, duplicate columns, or click empty slots to create clips. Use each clip’s play/stop button or its cell to control playback, and row numbers to launch a whole row. The floating Notes / Top button jumps between the note editor and the top of the app. New clears the current session and starts with one empty column. M and S control mute and solo. The master includes a 4:1 compressor.

Save downloads a version 2 JSON description (including note start, pitch, and duration); original version 1 projects remain loadable. The file contains a description of the project: oscillators, pitches, patterns, effects and mixer settings. Open validates and restores that file. There are no stored waveform samples and no server-side audio storage.

Record captures the live stereo master using AudioWorklet and encodes in a separate worker. Stop recording to preview or download a 192 kbps MP3. Recording requires a modern browser and HTTPS (or localhost). Keep the tab active for reliable scheduling. Unsaved projects and recordings live only in this tab; save JSON and export recordings before closing it.

## Development

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run typecheck`

The MP3 encoder is the unmodified `@breezystack/lamejs` module copied to `public/audio/lamejs.js`. Its LGPL-3.0 license is provided alongside it. The encoder can be replaced independently with another module exporting the same `Mp3Encoder` interface. Source: https://github.com/shijinyu/lamejs
