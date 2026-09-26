// Microphone capture can switch the device to a quieter communications route.
// Restore the music category after capture; never compensate by boosting gain.
const captures = new Set<symbol>();

export function prepareAudioPlayback() {
  setType(captures.size ? "play-and-record" : "playback");
}

function setType(type: "playback" | "play-and-record") {
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
  const token = Symbol();
  captures.add(token);
  prepareAudioPlayback();
  return () => {
    captures.delete(token);
    // Idempotent, including a stream arriving after permission was cancelled.
    prepareAudioPlayback();
  };
}
