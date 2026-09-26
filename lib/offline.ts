export function startOfflineApp(options: {
  busy: () => boolean;
  save: () => Promise<boolean>;
  ready: (value: boolean) => void;
}) {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return () => {};
  let disposed = false,
    registration: ServiceWorkerRegistration | undefined;
  let lastInput = Date.now(),
    needsReload = false,
    reloading = false;
  let controlled = !!navigator.serviceWorker.controller;
  const idle = () => !options.busy() && Date.now() - lastInput > 3000;
  const input = () => {
    lastInput = Date.now();
  };
  const reloadWhenSafe = async () => {
    if (disposed || !needsReload || reloading || !idle()) return;
    reloading = true;
    const saved = await options.save();
    if (!disposed && saved && idle()) location.reload();
    else reloading = false;
  };
  // This only activates an update already found at launch; it never fetches.
  const applyPendingUpdate = () => {
    if (disposed) return;
    if (idle())
      registration?.waiting?.postMessage({ type: "REQUEST_ACTIVATION" });
    void reloadWhenSafe();
  };
  const message = async (event: MessageEvent) => {
    if (event.data?.type !== "SAVE_BEFORE_UPDATE") return;
    const saved = idle() && (await options.save());
    (event.source as ServiceWorker | null)?.postMessage({
      type: "UPDATE_STATUS",
      requestId: event.data.requestId,
      ready: saved && idle(),
    });
  };
  const controller = () => {
    options.ready(true);
    if (controlled) {
      needsReload = true;
      void reloadWhenSafe();
    }
    controlled = true;
  };
  navigator.serviceWorker.addEventListener("message", message);
  navigator.serviceWorker.addEventListener("controllerchange", controller);
  window.addEventListener("pointerdown", input, { passive: true });
  window.addEventListener("keydown", input);
  window.addEventListener("input", input);
  const timer = setInterval(applyPendingUpdate, 10000);
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((r) => {
      if (disposed) return;
      registration = r;
      // One update check per page launch. No reconnection or periodic checks.
      if (navigator.onLine) void r.update().catch(() => {});
      if (r.active) options.ready(true);
      r.addEventListener("updatefound", () => {
        const installing = r.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") applyPendingUpdate();
        });
      });
      applyPendingUpdate();
    })
    .catch(() => options.ready(false));
  return () => {
    disposed = true;
    clearInterval(timer);
    navigator.serviceWorker.removeEventListener("message", message);
    navigator.serviceWorker.removeEventListener("controllerchange", controller);
    window.removeEventListener("pointerdown", input);
    window.removeEventListener("keydown", input);
    window.removeEventListener("input", input);
  };
}
