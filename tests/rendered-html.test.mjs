import assert from "node:assert/strict";
import test from "node:test";
test("production server renders the session controls without starter content", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Session<\/title>/);
  assert.match(html, /manifest.webmanifest/);
  assert.match(html, /data-session-shell="1"/);
  const viewport = html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? [];
  assert.equal(viewport.length, 1);
  assert.match(viewport[0], /maximum-scale=1/);
  assert.match(viewport[0], /user-scalable=(no|0)/);
  assert.match(html, /Edit tempo, 120 BPM/);
  assert.match(html, /Stop at end of bar/);
  const toolbar = html.match(
    /<header class="transport">([\s\S]*?)<\/header>/,
  )[1];
  assert.match(toolbar, /<span>BPM<\/span>/);
  assert.match(toolbar, /<b>120<\/b>/);
  const newButton = toolbar.match(
    /<button[^>]*aria-label="New empty session"[^>]*>([\s\S]*?)<\/button>/,
  )[1];
  assert.match(newButton, /lucide-file/);
  assert.doesNotMatch(newButton, /lucide-plus/);
  assert.doesNotMatch(
    toolbar,
    /class="position"|class="beat-dots"|class="signature"/,
  );
  assert.match(html, /Set A4, 440 Hz/);
  assert.match(html, /Set C4, 261.63 Hz/);
  assert.match(html, />Export<\/span>/);
  assert.match(html, /New empty session/);
  assert.match(html, /Play A1 and edit/);
  assert.match(html, /Scroll to note editor/);
  assert.match(html, /aria-label="Undo"/);
  assert.match(html, /aria-label="Redo"/);
  assert.doesNotMatch(html, /Add row|track-stop|device-tools|1 bar/);
  assert.match(html, /Closed hat/);
  assert.match(html, /Warm pad/);
  assert.match(html, /Record sound/);
  assert.match(html, /Construction wave count/);
  assert.match(html, /Construct with triangle waves/);
  assert.match(html, /Construct with square waves/);

  assert.match(html, /FFT/);
  assert.match(html, /Duplicate instrument A/);
  assert.match(html, /Delete instrument F/);
  assert.match(html, /Copyright © Giant Neural Network LLC/);
  assert.doesNotMatch(
    html,
    /aria-label="Play session"|<small>\.json<|footer-separator|Space to play/,
  );
  const emptySlots = [
    ...html.matchAll(/<div class="clip empty[^>]*>(.*?)<\/div>/g),
  ];
  assert.ok(emptySlots.length > 0);
  for (const [, slot] of emptySlots) {
    assert.doesNotMatch(slot, /clip-coordinate|clip-launch|mini-notes/);
    assert.equal((slot.match(/<svg/g) ?? []).length, 1);
  }
  assert.doesNotMatch(
    html,
    /Selection start seconds|Selection end seconds|Full sound|Preview sound|>Reconstruct</,
  );
  assert.doesNotMatch(
    html,
    /Session name|Track name|master-strip|Four on the floor/,
  );
  assert.doesNotMatch(
    html,
    /codex-preview|Building your site|react-loading-skeleton/,
  );
});
