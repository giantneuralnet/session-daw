# Session

A minimal browser DAW. Synthesizers run locally with Web Audio. Columns are identified by letters and rows by numbers. Each clip is one bar with a 16-step time grid and 97 scrollable pitch rows. Filling a column automatically appends a blank row across the grid, up to 64 rows. Clip launches and stops quantize to the next bar while the transport runs. Space starts/stops the transport.

Select Sound for drum and synth presets (kick, snare, hats, clap, tom, basses, keys, pad, lead, and bell), plus enlarged controls for wave shape, frequency, envelope, filter, reverb, and echo. Click a filled clip to select it for editing and start playback. While playing, click again to queue its stop on the next bar. Empty cells create new patterns. Tap empty space to add a note; tapping an existing note erases it silently. Scroll with a wheel or trackpad, use two fingers on touch (including over notes), or drag empty space with a mouse to browse pitches without creating notes. Drag notes to move them in time or pitch, and drag their right edge to change length. Pitch changes while moving a note play a short preview. Notes can overlap at different pitches for chords. Arrow keys move the editing cursor, Enter toggles a note, Delete erases, and Shift+arrows resize or transpose. Add columns with +, duplicate columns, or click empty slots to create clips. Use each clip’s play/stop button or its cell to control playback, and row numbers to launch a whole row. The centered floating Notes / Top button jumps between the note editor and the top of the app. New clears the current session and starts with one empty column. M and S control mute and solo. The master includes a 4:1 compressor.

Save downloads a version 2 JSON description (including note start, pitch, and duration); original version 1 projects remain loadable. The file contains a description of the project: oscillators, pitches, patterns, effects and mixer settings. Open validates and restores that file. There are no stored waveform samples and no server-side audio storage.

The first Record tap starts capturing the live stereo master without opening a dialog or starting any clips. Patterns start only when launched manually. Tap Record again to open export status: active clips finish their current bar, then the recorder waits for every channel and the master to remain below −80 dB peak for two seconds after the last voice ends. Reverb and echo remain connected throughout. The transport Stop button cuts voices and pending launches but keeps recording, including effect tails. Once finalized, preview or download the 192 kbps MP3. AudioWorklet captures audio and a separate worker encodes it. Recording requires a modern browser and HTTPS (or localhost). Keep the tab active for reliable scheduling. Unsaved projects and recordings live only in this tab; save JSON and export recordings before closing it.

## Development

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run typecheck`

The MP3 encoder is the unmodified `@breezystack/lamejs` module copied to `public/audio/lamejs.js`. Its LGPL-3.0 license is provided alongside it. The encoder can be replaced independently with another module exporting the same `Mp3Encoder` interface. Source: https://github.com/shijinyu/lamejs

Undo and redo are global for project edits, including notes, sounds, mixing, adding/removing tracks or rows, New, and loading a file. Use the toolbar buttons or Ctrl/Command+Z and Ctrl/Command+Shift+Z (Ctrl+Y also works). A slider drag is one history step. Playback and recording controls are not project-edit history; audio recordings are not restored by undo.

The note editor Copy button copies all notes in the current pattern to an in-app clipboard. Paste replaces the destination pattern’s notes while preserving pitches, positions, and lengths. Ctrl/Command+C and V work while focus is inside the note editor. Pasting is undoable.

Click the BPM display to open the tempo dialog. Enter a value from 40 to 240, use the ±10 BPM buttons, and Apply to commit one undoable change. Note-frequency shortcuts under Frequency use equal temperament with A4 = 440 Hz (C4 = 261.63 Hz).

The complete 16-step note grid fits the available width at every screen size; only the pitch axis scrolls. Page zoom gestures and shortcuts are suppressed, while two-finger note scrolling remains available.

The finished-recording dialog offers Export MP3 and Share. Share passes the MP3 file to the device share sheet where file sharing is supported; otherwise it downloads the MP3. Export MP3 in the toolbar reopens this dialog. Start another recording with the main transport Record button.
