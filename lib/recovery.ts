import { parseProject, type Project } from "./session.ts";
import { MIN_WINDOW, type SoundCapture } from "./sound-window.ts";
import { MAX_SECONDS, SAMPLE_RATE } from "./resynthesis.ts";

export const RECOVERY_KEY = "session-daw.recovery.v1";
export type RecoveryView = {
  selected: string;
  clipIndex: number;
  tab: "sound" | "pattern";
};
export type Recovery = RecoveryView & {
  schema: 1;
  savedAt: number;
  project: Project;
  captureIds: Record<string, string>;
};
export type SavedCapture = {
  id: string;
  trackId: string;
  samples: Float32Array;
  window: [number, number];
  appliedWindow?: [number, number];
  applied: boolean;
  count?: number;
  wave?: "sine" | "triangle" | "square";
};
export type Archive = { json: string; captures: SavedCapture[] };
export type ArchiveStore = {
  read: () => Promise<Archive | null>;
  write: (value: Archive) => Promise<void>;
};
const sampleIds = new WeakMap<Float32Array, string>();

export function packRecovery(
  project: Project,
  view: RecoveryView,
  captures: Map<string, SoundCapture>,
  savedAt = Date.now(),
): Archive {
  const rows: SavedCapture[] = [];
  const captureIds: Record<string, string> = {};
  for (const track of project.tracks) {
    const capture = captures.get(track.id);
    if (!capture) continue;
    let id = sampleIds.get(capture.samples);
    if (!id) {
      id = crypto.randomUUID();
      sampleIds.set(capture.samples, id);
    }
    captureIds[track.id] = id;
    rows.push({
      id,
      trackId: track.id,
      samples: capture.samples,
      window: [...capture.window],
      appliedWindow: capture.appliedWindow,
      applied: capture.appliedModel === track.reconstruction,
      count: capture.count,
      wave: capture.wave,
    });
  }
  // Transport is never restored in a playing state.
  const stopped = {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, active: -1 })),
  };
  return {
    json: JSON.stringify({
      schema: 1,
      savedAt,
      project: stopped,
      ...view,
      captureIds,
    }),
    captures: rows,
  };
}
export function parseRecovery(json: string): Recovery {
  const raw = JSON.parse(json);
  if (raw.schema !== 1 || !Number.isFinite(raw.savedAt))
    throw Error("Invalid recovery file.");
  const project = parseProject(JSON.stringify(raw.project));
  project.tracks.forEach((t) => {
    t.active = -1;
  });
  const selected = project.tracks.some((t) => t.id === raw.selected)
    ? raw.selected
    : project.tracks[0].id;
  const track = project.tracks.find((t) => t.id === selected)!;
  return {
    schema: 1,
    savedAt: raw.savedAt,
    project,
    selected,
    clipIndex: Number.isInteger(raw.clipIndex)
      ? Math.max(0, Math.min(track.clips.length - 1, raw.clipIndex))
      : 0,
    tab: raw.tab === "pattern" ? "pattern" : "sound",
    captureIds:
      raw.captureIds && typeof raw.captureIds === "object"
        ? raw.captureIds
        : {},
  };
}
export function restoreCaptures(recovery: Recovery, rows: SavedCapture[] = []) {
  const captures = new Map<string, SoundCapture>();
  for (const row of rows) {
    const track = recovery.project.tracks.find((t) => t.id === row.trackId);
    if (
      !track ||
      recovery.captureIds[row.trackId] !== row.id ||
      !(row.samples instanceof Float32Array) ||
      row.samples.length < MIN_WINDOW ||
      row.samples.length > SAMPLE_RATE * MAX_SECONDS ||
      !row.samples.every(Number.isFinite) ||
      !Array.isArray(row.window) ||
      row.window.length !== 2 ||
      !row.window.every(Number.isInteger) ||
      row.window[0] < 0 ||
      row.window[1] > row.samples.length ||
      row.window[1] - row.window[0] < MIN_WINDOW
    )
      continue;
    sampleIds.set(row.samples, row.id);
    captures.set(track.id, {
      samples: row.samples,
      window: row.window,
      appliedModel: row.applied ? track.reconstruction : undefined,
      appliedWindow: row.appliedWindow,
      count:
        Number.isInteger(row.count) && row.count! >= 1 && row.count! <= 32
          ? row.count
          : undefined,
      wave:
        row.wave && ["sine", "triangle", "square"].includes(row.wave)
          ? row.wave
          : undefined,
    });
  }
  return captures;
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("session-daw", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("recovery");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        database = undefined;
        reject(Error("Local storage is busy."));
      };
    });
  return database;
}
export const browserArchive: ArchiveStore = {
  async read() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("recovery", "readonly")
        .objectStore("recovery")
        .get("latest");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async write(value) {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("recovery", "readwrite");
      tx.objectStore("recovery").put(value, "latest");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

export class LocalRecovery {
  private pending: Promise<boolean> = Promise.resolve(true);
  private local: Pick<Storage, "getItem" | "setItem">;
  private archive: ArchiveStore;
  constructor(
    local: Pick<Storage, "getItem" | "setItem">,
    archive: ArchiveStore = browserArchive,
  ) {
    this.local = local;
    this.archive = archive;
  }
  async restore() {
    let local: Recovery | null = null,
      stored: Archive | null = null,
      archived: Recovery | null = null;
    try {
      const json = this.local.getItem(RECOVERY_KEY);
      if (json) local = parseRecovery(json);
    } catch {}
    try {
      stored = await this.archive.read();
      if (stored) archived = parseRecovery(stored.json);
    } catch {}
    const recovery =
      local && (!archived || local.savedAt >= archived.savedAt)
        ? local
        : archived;
    if (!recovery) return null;
    return { recovery, captures: restoreCaptures(recovery, stored?.captures) };
  }
  save(value: Archive): Promise<boolean> {
    // Synchronous JSON checkpoint also works during pagehide. The larger audio
    // archive writes are serialized so an older save cannot overwrite a newer one.
    let localSaved = false;
    try {
      this.local.setItem(RECOVERY_KEY, value.json);
      localSaved = true;
    } catch {}
    this.pending = this.pending
      .catch(() => false)
      .then(async () => {
        try {
          await this.archive.write(value);
          return true;
        } catch {
          return localSaved && value.captures.length === 0;
        }
      });
    return this.pending;
  }
}
