// The save that is open, handed between MirkMap and the save editor when one's link to the other is followed, so it need not be
// opened again: a folder (its handle: the editor asks for write access only when saving), a world in My worlds, or a copy of the
// files (a .zip, a dropped folder, or a folder picked where the browser gives no handle). Kept in this browser's IndexedDB, the only
// place a folder handle can be kept. The editor also opens the folder or library world it had open last when it loads on its own.

import type { Character, FileMap } from "./files.ts";
import type { LiveDirectory } from "./live.ts";

export interface StoredFile {
  path: string;
  data: Blob;
  modified?: number;
}

export type OpenSave =
  /** `live`: MirkMap was watching it with Live saves, and watches it again when it gets it back. */
  | { kind: "folder"; handle: LiveDirectory; live?: boolean }
  | { kind: "world"; id: string; name: string }
  | { kind: "files"; files: StoredFile[] };

export interface Handoff {
  save: OpenSave;
  /** The character on screen, shown again on the other page. */
  character?: Character;
}

export type Page = "map" | "editor";

const DB = "mirkmap-open";
const STORE = "open";
const KEY = "current";
/** Set in this tab's sessionStorage by the page handing over, so a page loaded any other way does not take a handoff meant for it. */
const FLAG = "mirkmap-handoff";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

/** Keeps `handoff` as the save that is open, for the editor to open again next time it loads. */
export async function remember(handoff: Handoff): Promise<void> {
  await run("readwrite", (store) => store.put(handoff, KEY));
}

/** Forgets the save open last, when a copy that is not kept is opened instead. */
export async function forget(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}

/** Keeps `handoff` for the page `to`, which this tab is about to open. */
export async function handOff(handoff: Handoff, to: Page): Promise<void> {
  await remember(handoff);
  sessionStorage.setItem(FLAG, to);
}

/**
 * What `page` opens as it loads: what the other page handed over in this tab or, in the editor, the folder or library world it had
 * open last. A copy of files is opened once, by the page it was handed to, and then forgotten. `handed`: the other page handed it.
 */
export async function takeHandoff(page: Page): Promise<{ handoff: Handoff; handed: boolean } | undefined> {
  const handed = sessionStorage.getItem(FLAG) === page;
  sessionStorage.removeItem(FLAG);
  if (!handed && page === "map") return undefined;
  const handoff = await run<Handoff | undefined>("readonly", (store) => store.get(KEY));
  if (!handoff?.save) return undefined;
  if (handoff.save.kind === "files") {
    if (!handed) return undefined;
    await forget();
  }
  return { handoff, handed };
}

/** The files of the character at `root` (every file when it is ""), read now, for handing over. */
export async function storedFiles(files: FileMap, root = ""): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (const [path, source] of files) {
    if (!path.startsWith(root)) continue;
    out.push({ path, data: new Blob([await source.read() as BlobPart]), modified: source.lastModified });
  }
  return out;
}

/** The files handed over, read again as a file map. */
export function fileMapOf(stored: StoredFile[]): FileMap {
  return new Map(stored.map((f) => [f.path, { read: async () => new Uint8Array(await f.data.arrayBuffer()), lastModified: f.modified }]));
}
