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

/** The folder or library world the editor had open last. */
const LAST = "last";
/** Each handoff is kept under its own key, so tabs handing over at the same time never take each other's. */
const TRANSFER = "transfer:";
/** A handoff whose page never loaded (the tab was closed first) is removed after this long. */
export const TRANSFER_TTL = 10 * 60_000;
/** This tab's sessionStorage names the page a handoff is for and its key, so only that page, loaded in this tab, takes it. */
const FLAG = "mirkmap-handoff";

interface Transfer {
  handoff: Handoff;
  at: number;
}

/**
 * Where handoffs are kept: `update` runs `work` on every record, by key, as one transaction, keeping what it leaves in the map. The
 * browser's is IndexedDB (`browserStore`); tests pass their own.
 */
export interface HandoffStore {
  update<T>(work: (records: Map<string, unknown>) => T): Promise<T>;
}

/** This tab's sessionStorage, or a stand-in. */
export type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the pages pass when nothing else is given: this browser's storage, its clock and random tokens. */
export interface HandoffContext {
  store: HandoffStore;
  tab: TabStorage;
  now: () => number;
  token: () => string;
}
const browser = (): HandoffContext => ({
  store: browserStore,
  tab: sessionStorage,
  now: Date.now,
  token: () => crypto.randomUUID(),
});

const DB = "mirkmap-open";
const STORE = "open";

/**
 * IndexedDB, the only place a browser keeps a folder handle. The store holds a few records (the last save and any handoffs in flight),
 * so a transaction reads them all, lets `work` change the map, and writes back what changed.
 */
export const browserStore: HandoffStore = {
  async update<T>(work: (records: Map<string, unknown>) => T): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let result: T;
        const keys = store.getAllKeys(), values = store.getAll();
        values.onsuccess = () => {
          const before = new Map(keys.result.map((key, i) => [String(key), values.result[i]] as const));
          const after = new Map(before);
          result = work(after);
          for (const key of before.keys()) if (!after.has(key)) store.delete(key);
          for (const [key, value] of after) if (before.get(key) !== value) store.put(value, key);
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};

/** Keeps `handoff` as the save that is open, for the editor to open again next time it loads. */
export async function remember(handoff: Handoff, { store } = browser()): Promise<void> {
  await store.update((records) => void records.set(LAST, handoff));
}

/** Forgets the save open last, when a copy that is not kept is opened instead. */
export async function forget({ store } = browser()): Promise<void> {
  await store.update((records) => void records.delete(LAST));
}

/** Keeps `handoff` for the page `to`, which this tab is about to open. */
export async function handOff(handoff: Handoff, to: Page, { store, tab, now, token } = browser()): Promise<void> {
  const key = token();
  const transfer: Transfer = { handoff, at: now() };
  await store.update((records) => void records.set(TRANSFER + key, transfer));
  tab.setItem(FLAG, JSON.stringify({ to, token: key }));
}

/** The key of the handoff this tab made for `page`, taking it from the tab's storage. */
function flagFor(page: Page, tab: TabStorage): string | undefined {
  const raw = tab.getItem(FLAG);
  tab.removeItem(FLAG);
  try {
    const flag: unknown = JSON.parse(raw ?? "null");
    if (!flag || typeof flag !== "object") return undefined;
    const { to, token } = flag as { to?: unknown; token?: unknown };
    return to === page && typeof token === "string" ? TRANSFER + token : undefined;
  } catch {
    return undefined;
  }
}

const isHandoff = (value: unknown): value is Handoff => !!value && typeof value === "object" && "save" in value && !!value.save;

/**
 * What `page` opens as it loads: what the other page handed over in this tab, taken once; or, in the editor, the folder or library
 * world it had open last. `handed`: the other page handed it over. Handoffs left behind longer than TRANSFER_TTL are removed.
 */
export async function takeHandoff(
  page: Page,
  { store, tab, now } = browser(),
): Promise<{ handoff: Handoff; handed: boolean } | undefined> {
  const key = flagFor(page, tab);
  const at = now();
  return await store.update((records) => {
    let handed: Handoff | undefined;
    for (const [k, value] of [...records]) {
      if (!k.startsWith(TRANSFER)) continue;
      const transfer = value as Partial<Transfer> | undefined;
      if (k === key) handed = transfer?.handoff;
      if (k === key || !(at - (transfer?.at ?? 0) < TRANSFER_TTL)) records.delete(k);
    }
    if (isHandoff(handed)) return { handoff: handed, handed: true };
    const last = page === "editor" ? records.get(LAST) : undefined;
    return isHandoff(last) && last.save.kind !== "files" ? { handoff: last, handed: false } : undefined;
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
