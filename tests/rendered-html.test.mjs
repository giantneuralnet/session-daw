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
  const viewport = html.match(/<meta[^>]+name="viewport"[^>]*>/g) ?? [];
  assert.equal(viewport.length, 1);
  assert.match(viewport[0], /maximum-scale=1/);
  assert.match(viewport[0], /user-scalable=(no|0)/);
  assert.match(html, /Edit tempo, 120 BPM/);
  assert.match(html, /Set A4, 440 Hz/);
  assert.match(html, /Set C4, 261.63 Hz/);
  assert.match(html, /Export MP3/);
  assert.match(html, /New empty session/);
  assert.match(html, /Play A1 and edit/);
  assert.match(html, /Scroll to note editor/);
  assert.match(html, /aria-label="Undo"/);
  assert.match(html, /aria-label="Redo"/);
  assert.doesNotMatch(html, /Add row|track-header|row-label-spacer/);
  assert.match(html, /Closed hat/);
  assert.match(html, /Warm pad/);
  assert.match(html, /Record sound/);
  assert.match(html, /Reconstruction frequencies/);
  assert.match(html, /Reconstruct/);
  assert.match(html, /5 seconds max/);
  assert.doesNotMatch(
    html,
    /Session name|Track name|master-strip|Four on the floor/,
  );
  assert.doesNotMatch(
    html,
    /codex-preview|Building your site|react-loading-skeleton/,
  );
});
