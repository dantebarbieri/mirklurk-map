// The "Cheated" mark. Saving any edit from the save editor marks the world for good, in three places:
// - MirkMap.ini in the character folder (cheated=1), which travels with uploads and shares and survives the game's own saves;
// - this browser's IndexedDB, keyed by world ID, so a deleted MirkMap.ini still shows the mark on this device;
// - the upload server, which keeps the mark for a world ID once any upload of it carried one (server/uploads.ts).
// MirkMap shows a cheated world with a C badge wherever it shows the world.

import type { FileMap } from "./files.ts";
import { MARKER, markerFlag, markerPath, markerText, readMarker, writeMarker } from "./marker.ts";

export const CHEATED_KEY = "cheated";

export interface CheatedInfo {
  /** ISO-8601 time of the first saved edit, when recorded. */
  since?: string;
  /** Saved edit sessions, when recorded. */
  edits?: number;
}

/** The mark in a MirkMap.ini's text, or undefined when it has none. */
export function cheatedInfo(text: string | undefined): CheatedInfo | undefined {
  if (text === undefined) return undefined;
  const m = readMarker(text);
  if (!markerFlag(m, CHEATED_KEY)) return undefined;
  const edits = Number(m.get("cheated_edits"));
  return { since: m.get("cheated_since") || undefined, edits: Number.isInteger(edits) && edits > 0 ? edits : undefined };
}

/** MirkMap.ini's text with the mark set: the first edit's time is kept and the edit count goes up by one. */
export function markCheated(text: string | undefined, now = new Date()): string {
  const before = text === undefined ? undefined : readMarker(text);
  const edits = Number(before?.get("cheated_edits"));
  return writeMarker(text, {
    cheated: "1",
    cheated_since: before?.get("cheated_since") || now.toISOString(),
    cheated_edits: String((Number.isInteger(edits) && edits > 0 ? edits : 0) + 1),
  });
}

/** Whether the character at `root` carries the mark in its MirkMap.ini. */
export async function isCheated(files: FileMap, root: string): Promise<boolean> {
  return cheatedInfo(await markerText(files, root)) !== undefined;
}

/** MirkMap.ini's text with the mark, without counting an edit: for restoring a mark that went missing. */
export const ensureCheated = (text: string | undefined): string =>
  text !== undefined && cheatedInfo(text) ? text : writeMarker(text, { [CHEATED_KEY]: "1" });

/** The files with the character's MirkMap.ini carrying the mark (added when missing, other keys kept). */
export async function withCheatedMarker(files: FileMap, root: string): Promise<FileMap> {
  const path = markerPath(files, root) ?? `${root}${MARKER}`;
  const bytes = new TextEncoder().encode(ensureCheated(await markerText(files, root)));
  const out: FileMap = new Map(files);
  out.set(path, { read: () => Promise.resolve(bytes), lastModified: files.get(path)?.lastModified });
  return out;
}

// --- This browser's record (IndexedDB), shared by the map and the editor on the same origin. ---

const DB = "mirkmap-editor";
export const CHEATED_STORE = "cheated";
export const BACKUP_STORE = "backups";

/** The editor's database: cheated world IDs, and backups of the files the editor replaced. */
export function editorDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(CHEATED_STORE);
      open.result.createObjectStore(BACKUP_STORE, { keyPath: "id", autoIncrement: true }).createIndex("world", "world");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Remembers that this browser saved edits to the world, for good. */
export async function rememberCheated(world: string, at = Date.now()): Promise<void> {
  const db = await editorDb();
  try {
    const store = db.transaction(CHEATED_STORE, "readwrite").objectStore(CHEATED_STORE);
    if ((await request(store.get(world))) === undefined) await request(store.put({ at }, world));
  } finally {
    db.close();
  }
}

/** Whether this browser ever saved edits to the world. False where IndexedDB is unavailable. */
export async function knownCheated(world: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    const db = await editorDb();
    try {
      return (await request(db.transaction(CHEATED_STORE).objectStore(CHEATED_STORE).get(world))) !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
