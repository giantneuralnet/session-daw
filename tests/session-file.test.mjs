import test from "node:test";
import assert from "node:assert/strict";
import { sessionFile, fileSize } from "../lib/session-file.ts";
import {
  initialProject,
  parseProject,
  nextColumnName,
  makeTrack,
} from "../lib/session.ts";

test("save names and file sizes describe the exact UTF-8 JSON download without mutating the open project", async () => {
  const project = initialProject();
  const original = structuredClone(project);
  const file = sessionFile(project, "  Étude 🎹.json  ");
  const json = await file.blob.text();
  assert.equal(file.filename, "Étude 🎹.json");
  assert.equal(file.blob.type, "application/json");
  assert.equal(file.blob.size, Buffer.byteLength(json, "utf8"));
  assert.ok(file.blob.size > json.length);
  assert.equal(parseProject(json).name, "Étude 🎹");
  assert.deepEqual(
    project,
    original,
    "opening or cancelling the save dialog does not rename the session",
  );
  assert.equal(sessionFile(project, "").filename, "Session.json");
  assert.equal(sessionFile(project, "bad/name?.JSON").filename, "badname.json");
  assert.equal(sessionFile(project, "a".repeat(100)).name.length, 80);
  assert.equal(fileSize(500), "500 bytes");
  assert.equal(fileSize(1024), "1.0 KB");
  assert.equal(fileSize(1024 * 1024), "1.00 MB");
});

test("new instrument names avoid collisions while existing names survive deletion, insertion and JSON reload", () => {
  const p = initialProject();
  const remaining = p.tracks.filter((t) => t.name !== "B");
  const names = remaining.map((t) => t.name);
  const added = {
    ...makeTrack(remaining.length),
    name: nextColumnName(remaining),
  };
  assert.equal(added.name, "B");
  const withAdded = [...remaining, added];
  assert.deepEqual(
    withAdded.slice(0, -1).map((t) => t.name),
    names,
  );
  const duplicate = {
    ...structuredClone(withAdded[1]),
    id: "duplicate",
    name: nextColumnName(withAdded),
  };
  assert.equal(duplicate.name, "G");
  withAdded.splice(2, 0, duplicate);
  const loaded = parseProject(JSON.stringify({ ...p, tracks: withAdded }));
  assert.deepEqual(
    loaded.tracks.map((t) => t.name),
    ["A", "C", "G", "D", "E", "F", "B"],
  );
  assert.deepEqual(
    remaining.map((t) => t.name),
    names,
  );
});
