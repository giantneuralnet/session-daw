/* The build replaces the version and asset list. No user audio is cached here. */
const VERSION = "__BUILD_VERSION__";
const ASSETS = __BUILD_ASSETS__;
const PREFIX = "session-daw-shell-";
const CACHE = PREFIX + VERSION;
const paths = new Set(ASSETS);

self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        for (let i = 0; i < ASSETS.length; i += 8) {
          await Promise.all(
            ASSETS.slice(i, i + 8).map(async (path) => {
              const response = await fetch(path, {
                credentials: "same-origin",
                cache: "reload",
              });
              if (
                !response.ok ||
                response.redirected ||
                response.headers.get("content-type")?.includes("text/html")
              )
                throw Error("Offline asset unavailable: " + path);
              await cache.put(path, response);
            }),
          );
        }
        const response = await fetch("/", {
          credentials: "same-origin",
          cache: "reload",
        });
        if (
          !response.ok ||
          response.redirected ||
          !(await response.clone().text()).includes('data-session-shell="1"')
        )
          throw Error("Session shell is unavailable.");
        await cache.put("/", response);
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  ),
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Keep the previous complete bundle for any older tab that is still busy.
      const old = (await caches.keys()).filter(
        (key) => key.startsWith(PREFIX) && key !== CACHE,
      );
      await Promise.all(old.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  const isShell = event.request.mode === "navigate" && url.pathname === "/";
  if (!isShell && !paths.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (
        (await cache.match(isShell ? "/" : url.pathname)) ||
        fetch(event.request)
      );
    })(),
  );
});

let activation = null;
let activationPending = false;
self.addEventListener("message", (event) => {
  if (
    event.data?.type === "UPDATE_STATUS" &&
    activation &&
    event.data.requestId === activation.id
  ) {
    if (!activation.clients.has(event.source?.id)) return;
    activation.clients.delete(event.source.id);
    activation.safe = activation.safe && event.data.ready === true;
    if (!activation.clients.size) activation.done();
  }
  if (event.data?.type !== "REQUEST_ACTIVATION" || activationPending) return;
  activationPending = true;
  event.waitUntil(
    (async () => {
      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        if (!clients.length) {
          await self.skipWaiting();
          return;
        }
        const id = VERSION + ":" + Date.now();
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            activation.safe = false;
            activation.done();
          }, 5000);
          activation = {
            id,
            clients: new Set(clients.map((client) => client.id)),
            safe: true,
            done: () => {
              clearTimeout(timeout);
              resolve();
            },
          };
          clients.forEach((client) =>
            client.postMessage({ type: "SAVE_BEFORE_UPDATE", requestId: id }),
          );
        });
        const safe = activation.safe;
        activation = null;
        if (safe) await self.skipWaiting();
      } finally {
        activationPending = false;
      }
    })(),
  );
});
