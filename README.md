# Session

A minimal browser DAW. Synthesizers run locally with Web Audio. Columns are identified by letters and rows by numbers. Each clip is one bar with a 16-step time grid and 97 scrollable pitch rows. Add row extends the session grid up to 64 rows. Clip launches and stops quantize to the next bar while the transport runs. Space starts/stops the transport.

Select Sound to edit wave shape, frequency, envelope, filter, reverb, and echo. Click a filled clip to select it for editing and start playback. While playing, click again to queue its stop on the next bar. Empty cells create new patterns. Tap empty space to add a note; tapping an existing note erases it silently. Scroll with a wheel or trackpad, swipe on touch, or drag empty space with a mouse to browse pitches without creating notes. Drag notes to move them in time or pitch, and drag their right edge to change length. Pitch changes while moving a note play a short preview. Notes can overlap at different pitches for chords. Arrow keys move the editing cursor, Enter toggles a note, Delete erases, and Shift+arrows resize or transpose. Add columns with +, duplicate columns, or click empty slots to create clips. Use each clip’s play/stop button or its cell to control playback, and row numbers to launch a whole row. The centered floating Notes / Top button jumps between the note editor and the top of the app. New clears the current session and starts with one empty column. M and S control mute and solo. The master includes a 4:1 compressor.

Save downloads a version 2 JSON description (including note start, pitch, and duration); original version 1 projects remain loadable. The file contains a description of the project: oscillators, pitches, patterns, effects and mixer settings. Open validates and restores that file. There are no stored waveform samples and no server-side audio storage.

Record captures the live stereo master using AudioWorklet and encodes in a separate worker. Stop recording to preview or download a 192 kbps MP3. Recording requires a modern browser and HTTPS (or localhost). Keep the tab active for reliable scheduling. Unsaved projects and recordings live only in this tab; save JSON and export recordings before closing it.

## Development

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run typecheck`

The MP3 encoder is the unmodified `@breezystack/lamejs` module copied to `public/audio/lamejs.js`. Its LGPL-3.0 license is provided alongside it. The encoder can be replaced independently with another module exporting the same `Mp3Encoder` interface. Source: https://github.com/shijinyu/lamejs

Undo and redo are global for project edits, including notes, sounds, mixing, adding/removing tracks or rows, New, and loading a file. Use the toolbar buttons or Ctrl/Command+Z and Ctrl/Command+Shift+Z (Ctrl+Y also works). A slider drag is one history step. Playback and recording controls are not project-edit history; audio recordings are not restored by undo.

The note editor Copy button copies all notes in the current pattern to an in-app clipboard. Paste replaces the destination pattern’s notes while preserving pitches, positions, and lengths. Ctrl/Command+C and V work while focus is inside the note editor. Pasting is undoable.
