// The save that is open, handed between MirkMap and the save editor when one's link to the other is followed, so it need not be
// opened again: a folder (its handle: the editor asks for write access only when saving), a world in My worlds, or a copy of the
// files (a .zip, a dropped folder, or a folder picked where the browser gives no handle). Kept in this browser's IndexedDB, the only
// place a folder handle can be kept, each handoff under its own key. The editor also opens the folder or library world it had open last
// when it loads on its own.

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
  /** `library`: the ID of the library the world is in (libraryId of its key), as this browser can keep several. */
  | { kind: "world"; id: string; name: string; library: string }
  | { kind: "files"; files: StoredFile[] };

export interface Handoff {
  save: OpenSave;
  /** The character on screen, shown again on the other page. */
  character?: Character;
}

export type Page = "map" | "editor";

const DB = "mirkmap-open";
const STORE = "open";
/** The folder or library world the editor had open last. */
const LAST = "last";
/** Each handoff is kept under its own key, so tabs handing over at the same time never take each other's. */
const TRANSFER = "transfer:";
/** A handoff whose page never loaded (the tab was closed first) is removed after this long. */
const TRANSFER_TTL = 10 * 60_000;
/** This tab's sessionStorage names the page a handoff is for and its key, so only that page, loaded in this tab, takes it. */
const FLAG = "mirkmap-handoff";

interface Transfer {
  handoff: Handoff;
  at: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** One transaction on the store; resolves with `done()` once it has committed. */
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const done = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(done());
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Keeps `handoff` as the save that is open, for the editor to open again next time it loads. */
export async function remember(handoff: Handoff): Promise<void> {
  await transaction("readwrite", (store) => (store.put(handoff, LAST), () => undefined));
}

/** Forgets the save open last, when a copy that is not kept is opened instead. */
export async function forget(): Promise<void> {
  await transaction("readwrite", (store) => (store.delete(LAST), () => undefined));
}

/** Keeps `handoff` for the page `to`, which this tab is about to open. */
export async function handOff(handoff: Handoff, to: Page): Promise<void> {
  const token = crypto.randomUUID();
  const transfer: Transfer = { handoff, at: Date.now() };
  await transaction("readwrite", (store) => (store.put(transfer, TRANSFER + token), () => undefined));
  sessionStorage.setItem(FLAG, JSON.stringify({ to, token }));
}

/** The key of the handoff this tab made for `page`, taking it from sessionStorage. */
function flagFor(page: Page): string | undefined {
  const raw = sessionStorage.getItem(FLAG);
  sessionStorage.removeItem(FLAG);
  try {
    const flag: unknown = JSON.parse(raw ?? "null");
    if (!flag || typeof flag !== "object") return undefined;
    const { to, token } = flag as { to?: unknown; token?: unknown };
    return to === page && typeof token === "string" ? TRANSFER + token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What `page` opens as it loads: what the other page handed over in this tab, taken once; or, in the editor, the folder or library
 * world it had open last. `handed`: the other page handed it over.
 */
export async function takeHandoff(page: Page): Promise<{ handoff: Handoff; handed: boolean } | undefined> {
  const key = flagFor(page);
  const now = Date.now();
  return await transaction("readwrite", (store) => {
    let handed: Handoff | undefined, last: Handoff | undefined;
    const cursor = store.openCursor(IDBKeyRange.bound(TRANSFER, `${TRANSFER}\uffff`));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const transfer = c.value as Transfer;
      if (c.key === key) handed = transfer.handoff;
      if (c.key === key || !(now - transfer.at < TRANSFER_TTL)) c.delete();
      c.continue();
    };
    if (page === "editor") {
      const request = store.get(LAST);
      request.onsuccess = () => last = request.result;
    }
    return () =>
      handed?.save
        ? { handoff: handed, handed: true }
        : last?.save && last.save.kind !== "files"
        ? { handoff: last, handed: false }
        : undefined;
  });
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
