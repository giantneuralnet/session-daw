import test from "node:test";
import assert from "node:assert/strict";
import { MicrophoneRecording } from "../lib/microphone.ts";
import {
  beginMicrophoneSession,
  prepareAudioPlayback,
} from "../lib/audio-session.ts";

function environment(
  t,
  { permissionError, moduleError, delayedClose = false } = {},
) {
  const originals = new Map();
  function replace(key, value) {
    if (!originals.has(key))
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
  });
  const events = [];
  let type = "auto",
    worklet,
    finishClose;
  const session = {
    get type() {
      return type;
    },
    set type(value) {
      type = value;
      events.push(value);
    },
  };
  const track = {
    stop() {
      events.push("track stopped");
    },
    addEventListener() {},
  };
  replace("navigator", {
    audioSession: session,
    mediaDevices: {
      async getUserMedia() {
        assert.equal(type, "auto");
        if (permissionError) throw permissionError;
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      },
    },
  });
  replace(
    "AudioContext",
    class {
      sampleRate = 24000;
      state = "running";
      destination = {};
      audioWorklet = {
        async addModule() {
          if (moduleError) throw moduleError;
        },
      };
      async resume() {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      async close() {
        events.push("closing");
        if (delayedClose)
          await new Promise((resolve) => {
            finishClose = resolve;
          });
        this.state = "closed";
        events.push("closed");
      }
    },
  );
  replace(
    "AudioWorkletNode",
    class {
      port = {
        postMessage: () =>
          queueMicrotask(() => this.port.onmessage({ data: { done: true } })),
      };
      constructor() {
        worklet = this;
      }
      connect() {}
      disconnect() {}
    },
  );
  replace(
    "OfflineAudioContext",
    class {
      constructor(_channels, length) {
        this.length = length;
      }
      destination = {};
      createBuffer(_channels, length) {
        return { getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        return { connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => new Float32Array(this.length) };
      }
    },
  );
  return {
    session,
    events,
    replace,
    send: (data) => worklet.port.onmessage({ data }),
    finishClose: () => finishClose(),
  };
}

test("FFT capture stops the microphone and closes its context before restoring playback and completing", async (t) => {
  const env = environment(t, { delayedClose: true });
  const mic = new MicrophoneRecording();
  const completed = new Promise((resolve) => {
    mic.onComplete = resolve;
  });
  await mic.start();
  env.send({ samples: new Float32Array(2400) });
  mic.stop();
  await Promise.resolve();
  assert.equal(env.session.type, "auto");
  assert.deepEqual(env.events, ["track stopped", "closing"]);
  env.finishClose();
  assert.equal((await completed).length, 2400);
  assert.deepEqual(env.events.slice(-2), ["closed", "playback"]);
});

test("denied permission and worklet startup failures restore playback without caller cleanup", async (t) => {
  for (const options of [
    { permissionError: Error("denied") },
    { moduleError: Error("worklet failed") },
  ]) {
    await t.test(Object.keys(options)[0], async (t) => {
      const env = environment(t, options);
      const mic = new MicrophoneRecording();
      await assert.rejects(mic.start());
      assert.equal(env.session.type, "playback");
      assert.equal(env.events.at(-2), "closed");
      if (options.moduleError) assert.ok(env.events.includes("track stopped"));
    });
  }
});

test("short takes restore normal playback before reporting the error", async (t) => {
  const env = environment(t);
  const mic = new MicrophoneRecording();
  const failure = new Promise((resolve) => {
    mic.onError = resolve;
  });
  await mic.start();
  mic.stop();
  assert.match(await failure, /at least/);
  assert.equal(env.session.type, "playback");
});

test("late microphone permission cannot leave the device in capture mode after disposal", async (t) => {
  const env = environment(t);
  let grant;
  navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const mic = new MicrophoneRecording();
  const pending = mic.start();
  await Promise.resolve();
  mic.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  env.session.type = "auto"; // A late device acquisition changes the route again.
  let stopped = false;
  grant({
    getTracks: () => [
      {
        stop() {
          stopped = true;
        },
      },
    ],
  });
  await pending;
  assert.equal(stopped, true);
  assert.equal(env.session.type, "playback");
});

test("playback requests and old cleanup cannot interrupt a newer microphone capture", (t) => {
  const { session } = environment(t);
  const endFirst = beginMicrophoneSession();
  const endSecond = beginMicrophoneSession();
  endFirst();
  prepareAudioPlayback();
  assert.equal(session.type, "auto");
  endSecond();
  endFirst();
  assert.equal(session.type, "playback");
});

test("optional audio-session support never blocks recording or playback", (t) => {
  const env = environment(t);
  for (const navigator of [
    {},
    {
      get audioSession() {
        throw Error("unsupported");
      },
    },
  ]) {
    env.replace("navigator", navigator);
    assert.doesNotThrow(() => {
      prepareAudioPlayback();
      beginMicrophoneSession()();
    });
  }
});

test("delayed device release reselects playback, and a new take cancels that recovery", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { session, events } = environment(t);
  session.type = "playback";
  const endFirst = beginMicrophoneSession();
  assert.equal(session.type, "auto");
  endFirst();
  events.length = 0;
  t.mock.timers.tick(250);
  assert.deepEqual(events, ["auto", "playback"]);
  const endSecond = beginMicrophoneSession();
  endSecond();
  const endThird = beginMicrophoneSession();
  events.length = 0;
  t.mock.timers.tick(500);
  assert.deepEqual(
    events,
    [],
    "old recovery must not interfere with a new capture",
  );
  assert.equal(session.type, "auto");
  endThird();
  t.mock.timers.tick(250);
  assert.equal(session.type, "playback");
});
