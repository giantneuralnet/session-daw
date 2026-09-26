// Let unprocessed microphone capture choose its own route. Explicitly asking
// for play-and-record can force WebKit's separate video-chat volume/mode.
// Never change mixer gain or suspend playback to recover the output route.
const captures = new Set<symbol>();
let restoreTimer: ReturnType<typeof setTimeout> | undefined;

export function prepareAudioPlayback() {
  setType(captures.size ? "auto" : "playback");
}

function setType(type: "playback" | "auto") {
  try {
    const session =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & { audioSession?: { type: string } })
            .audioSession
        : undefined;
    if (session && session.type !== type) session.type = type;
  } catch {
    // Optional API: unsupported browsers retain their normal audio routing.
  }
}

export function beginMicrophoneSession() {
  clearTimeout(restoreTimer);
  const token = Symbol();
  captures.add(token);
  prepareAudioPlayback();
  return () => {
    captures.delete(token);
    // Idempotent, including a stream arriving after permission was cancelled.
    prepareAudioPlayback();
    if (!captures.size) {
      clearTimeout(restoreTimer);
      // Device release is asynchronous on WebKit. Re-select music playback
      // once it has settled, without restarting any context, voice or clock.
      restoreTimer = setTimeout(() => {
        if (captures.size) return;
        setType("auto");
        setType("playback");
      }, 250);
    }
  };
}
