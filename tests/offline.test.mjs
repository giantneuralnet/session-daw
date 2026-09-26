import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function workerHarness() {
  const stores = new Map(),
    handlers = {},
    clients = [];
  let offline = false,
    badShell = false,
    skip = 0,
    claims = 0,
    network = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async put(key, response) {
          values.set(key, response.clone());
        },
        async match(key) {
          return values
            .get(typeof key === "string" ? key : new URL(key.url).pathname)
            ?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(key) {
      return stores.delete(key);
    },
  };
  const self = {
    location: { origin: "https://session.test" },
    addEventListener: (name, fn) => (handlers[name] = fn),
    clients: {
      async matchAll() {
        return clients;
      },
      async claim() {
        claims++;
      },
    },
    async skipWaiting() {
      skip++;
    },
  };
  const fetch = async (request) => {
    network++;
    if (offline) throw Error("Offline");
    const path =
      typeof request === "string" ? request : new URL(request.url).pathname;
    return new Response(
      path === "/"
        ? badShell
          ? "Sign in"
          : '<body data-session-shell="1">Session</body>'
        : "/* audio asset */",
      {
        headers: {
          "content-type": path === "/" ? "text/html" : "application/javascript",
        },
      },
    );
  };
  const script = fs
    .readFileSync(
      new URL("../scripts/service-worker.js", import.meta.url),
      "utf8",
    )
    .replace('"__BUILD_VERSION__"', '"test-version"')
    .replace(
      "__BUILD_ASSETS__",
      JSON.stringify([
        "/audio/microphone.js",
        "/audio/encoder.js",
        "/_next/static/page.js",
      ]),
    );
  vm.runInNewContext(script, {
    self,
    caches,
    fetch,
    URL,
    Response,
    setTimeout,
    clearTimeout,
  });
  async function dispatch(name, data = {}) {
    const promises = [];
    let response;
    handlers[name]({
      ...data,
      waitUntil: (p) => promises.push(p),
      respondWith: (p) => (response = p),
    });
    await Promise.all(promises);
    return response ? await response : undefined;
  }
  return {
    stores,
    clients,
    dispatch,
    setOffline: (value) => (offline = value),
    setBadShell: () => (badShell = true),
    counts: () => ({ skip, claims, network }),
  };
}
test("offline shell and audio dependencies work without a network; auth and external requests are untouched", async () => {
  const h = workerHarness();
  await h.dispatch("install");
  await h.dispatch("activate");
  h.setOffline(true);
  const request = (path, mode = "cors") => ({
    url: "https://session.test" + path,
    method: "GET",
    mode,
  });
  const count = h.counts().network;
  assert.match(
    await (
      await h.dispatch("fetch", { request: request("/", "navigate") })
    ).text(),
    /data-session-shell/,
  );
  for (const path of [
    "/audio/microphone.js",
    "/audio/encoder.js",
    "/_next/static/page.js",
  ])
    assert.equal(
      (await h.dispatch("fetch", { request: request(path) })).status,
      200,
    );
  assert.equal(h.counts().network, count);
  assert.equal(
    await h.dispatch("fetch", {
      request: request("/signin-with-chatgpt", "navigate"),
    }),
    undefined,
  );
  assert.equal(
    await h.dispatch("fetch", {
      request: { url: "https://other.test/", method: "GET", mode: "navigate" },
    }),
    undefined,
  );
});
test("an incomplete or login shell never replaces a working offline cache", async () => {
  const h = workerHarness();
  h.stores.set("session-daw-shell-old", new Map());
  h.setBadShell();
  await assert.rejects(h.dispatch("install"), /shell is unavailable/);
  assert.ok(h.stores.has("session-daw-shell-old"));
  assert.ok(!h.stores.has("session-daw-shell-test-version"));
});
test("updates require every open app to save and be idle", async () => {
  const h = workerHarness();
  let busy = true;
  for (const id of ["one", "two"])
    h.clients.push({
      id,
      postMessage(data) {
        queueMicrotask(() =>
          h.dispatch("message", {
            source: { id },
            data: {
              type: "UPDATE_STATUS",
              requestId: data.requestId,
              ready: id === "one" || !busy,
            },
          }),
        );
      },
    });
  await h.dispatch("message", { data: { type: "REQUEST_ACTIVATION" } });
  assert.equal(h.counts().skip, 0);
  busy = false;
  await h.dispatch("message", { data: { type: "REQUEST_ACTIVATION" } });
  assert.equal(h.counts().skip, 1);
});
function target() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name),
  };
}
test("app checks for updates only at launch and saves before an idle reload", async () => {
  const window = target(),
    document = target(),
    serviceWorker = { ...target(), controller: {} };
  const timers = [];
  let checks = 0,
    reloads = 0,
    saved = 0,
    now = 0,
    busy = true;
  const registration = {
    ...target(),
    active: {},
    waiting: { postMessage() {} },
    update: async () => {
      checks++;
    },
  };
  serviceWorker.register = async () => registration;
  const source = fs
    .readFileSync(new URL("../lib/offline.ts", import.meta.url), "utf8")
    .replace("import.meta.env.PROD", "true");
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace("export function", "function");
  const start = vm.runInNewContext(compiled + "\nstartOfflineApp", {
    navigator: { serviceWorker, onLine: true },
    window,
    document,
    Date: { now: () => now },
    location: {
      reload() {
        reloads++;
      },
    },
    setInterval: (fn) => {
      timers.push(fn);
      return 1;
    },
    clearInterval() {},
  });
  const dispose = start({
    busy: () => busy,
    save: async () => {
      saved++;
      return true;
    },
    ready() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(checks, 1);
  assert.equal(window.handlers.has("online"), false);
  assert.equal(document.handlers.has("visibilitychange"), false);
  now = 10000;
  timers[0]();
  timers[0]();
  assert.equal(checks, 1);
  serviceWorker.handlers.get("controllerchange")();
  assert.equal(reloads, 0);
  busy = false;
  timers[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saved, 1);
  assert.equal(reloads, 1);
  assert.equal(checks, 1);
  dispose();
});
test("deployment includes installable icons, a versioned cache, and all audio workers", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      new URL("../dist/client/manifest.webmanifest", import.meta.url),
    ),
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  for (const icon of manifest.icons) {
    const data = fs.readFileSync(
      new URL("../dist/client" + icon.src, import.meta.url),
    );
    assert.equal(data.readUInt32BE(16), +icon.sizes.split("x")[0]);
  }
  const sw = fs.readFileSync(
    new URL("../dist/client/sw.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(sw, /__BUILD_VERSION__|__BUILD_ASSETS__/);
  for (const asset of [
    "/audio/microphone.js",
    "/audio/encoder.js",
    "/audio/lamejs.js",
    "/audio/recorder.js",
    "resynthesis.worker-",
  ])
    assert.ok(sw.includes(asset));
});
