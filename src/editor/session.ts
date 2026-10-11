// Save editor: one character folder opened for writing with the File System Access API (desktop Chrome and Edge). Edits change
// parsed copies of the save files (drafts) until they are saved. Saving refuses if the game wrote the folder since it was read, keeps
// the replaced files in this browser as a backup, writes the Cheated mark into MirkMap.ini first and then each changed file the way
// save_datajson does: JSON and one NUL byte.

import type { Character, FileMap } from "../files.ts";
import { captureSnapshot, currentContainers, type LiveDirectory, type LiveFile, type Scan, scanDirectory } from "../live.ts";
import { MARKER, markerPath, markerText } from "../marker.ts";
import { BACKUP_STORE, editorDb, markCheated, rememberCheated, request } from "../cheated.ts";
import { decodeJson, parsePlayer } from "../save.ts";

export interface EditDirectory extends LiveDirectory {
  values(): AsyncIterable<EditDirectory | EditFile>;
  getDirectoryHandle(name: string): Promise<EditDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<EditFile>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}
export interface EditFile extends LiveFile {
  createWritable(): Promise<{ write(data: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }>;
}
export interface WritablePicker {
  showDirectoryPicker?(options: { mode: "readwrite"; id?: string }): Promise<EditDirectory>;
}

export const canEdit = () => typeof (globalThis as WritablePicker).showDirectoryPicker === "function" && globalThis.isSecureContext;

/** One saved edit session's replaced files, kept in this browser. */
export interface Backup {
  id?: number;
  world: string;
  character: string;
  at: number;
  /** What was changed, as listed before saving. */
  changes: string[];
  files: { path: string; bytes: Uint8Array }[];
}

/** Backups kept per world; older ones are removed. */
export const BACKUPS_KEPT = 10;

const encoder = new TextEncoder();
const encodeSave = (value: unknown) => {
  const json = encoder.encode(JSON.stringify(value));
  const out = new Uint8Array(json.length + 1);
  out.set(json);
  return out;
};

export class StaleError extends Error {}

/** Where a session keeps backups and its record of cheated worlds; this browser's IndexedDB unless a test passes its own. */
export interface SessionStore {
  backup(backup: Backup): Promise<void>;
  remember(world: string): Promise<void>;
}
const browserStore: SessionStore = { backup: (b) => storeBackup(b), remember: (w) => rememberCheated(w) };

export class EditSession {
  private drafts = new Map<string, unknown>();
  private dirty = new Set<string>();
  private notes: string[] = [];

  constructor(
    readonly dir: EditDirectory,
    private scan: Scan,
    public files: FileMap,
    readonly character: Character,
    readonly world: string,
    private store: SessionStore = browserStore,
  ) {}

  /** Reads a folder (any depth) for editing, with Live saves' checks that no save is half written. */
  static async open(dir: EditDirectory): Promise<{ scan: Scan; files: FileMap }> {
    const scan = await scanDirectory(dir);
    return { scan, files: (await captureSnapshot(scan)).files };
  }

  /** The draft of a save file, parsed on first use; edits change it in place. */
  async json(path: string): Promise<unknown> {
    if (!this.drafts.has(path)) {
      const src = this.files.get(path);
      if (!src) throw new Error(`${path} is missing`);
      this.drafts.set(path, decodeJson(await src.read()));
    }
    return this.drafts.get(path);
  }

  /** Records that the draft at `path` was changed, with a line for the list of unsaved changes. */
  changed(path: string, note: string) {
    if (!this.drafts.has(path)) throw new Error(`${path} was not read for editing`);
    this.dirty.add(path);
    this.notes.push(note);
  }

  get changes(): readonly string[] {
    return this.notes;
  }

  discard() {
    if (this.busy) throw new Error("Wait for the save to finish");
    this.clear();
  }
  private clear() {
    this.drafts.clear();
    this.dirty.clear();
    this.notes = [];
  }
  private busy = false;
  /** A save or restore is writing files. */
  get saving(): boolean {
    return this.busy;
  }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Wait for the save to finish");
    this.busy = true;
    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }

  private async handle(path: string, create = false): Promise<EditFile> {
    const parts = path.split("/");
    if (parts[0] !== this.dir.name) throw new Error(`${path} is outside the opened folder`);
    let dir = this.dir;
    for (const part of parts.slice(1, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }

  private async write(path: string, bytes: Uint8Array | string) {
    const out = await (await this.handle(path, true)).createWritable();
    await out.write(typeof bytes === "string" ? bytes : bytes as BufferSource);
    await out.close();
  }

  /** Throws a StaleError if any file of this character changed on disk since it was read. */
  private async checkFresh(): Promise<Scan> {
    const now = await scanDirectory(this.dir);
    const root = this.character.root;
    const differs = [...new Set([...this.scan.entries.keys(), ...now.entries.keys()])].filter((path) =>
      path.startsWith(root) && this.scan.entries.get(path)?.stamp !== now.entries.get(path)?.stamp
    );
    if (differs.length) {
      throw new StaleError(
        `The game changed ${
          differs.length === 1 ? differs[0].slice(root.length) : `${differs.length} files`
        } since this folder was read. ` +
          "Reopen the folder to edit the newest save; these unsaved edits cannot be applied.",
      );
    }
    return now;
  }

  /**
   * Writes every changed draft, in the game's own order so readers that wait for a save to finish (Live saves) accept it: Player.save
   * first, then the other files, and the current area's Containers.save last (rewritten as it is when it did not change). The drafts
   * are encoded before anything is awaited, so nothing done meanwhile changes what is written. Returns the number of files written.
   */
  save(): Promise<number> {
    if (!this.dirty.size) return Promise.resolve(0);
    const pending = new Map([...this.dirty].map((path) => [path, encodeSave(this.drafts.get(path))] as const));
    const changes = [...this.notes];
    return this.exclusive(async () => {
      await this.checkFresh();
      const root = this.character.root;
      const player = `${root}Player.save`;
      const playerBytes = pending.get(player) ?? await this.files.get(player)!.read();
      const last = currentContainers(this.files, root, parsePlayer(decodeJson(playerBytes)));
      if (!last) throw new Error("The player's area has no Containers.save; the game would not finish loading it");
      const backup: Backup = { world: this.world, character: this.character.name, at: Date.now(), changes, files: [] };
      for (const path of pending.keys()) backup.files.push({ path, bytes: await this.files.get(path)!.read() });
      await this.store.backup(backup);
      // The mark goes first, so an interrupted save is still marked.
      const marker = markerPath(this.files, root) ?? `${root}${MARKER}`;
      await this.write(marker, markCheated(await markerText(this.files, root)));
      await this.store.remember(this.world);
      const order = [...pending.keys()].sort((a, b) =>
        Number(b === player) - Number(a === player) || Number(a === last) - Number(b === last)
      );
      for (const path of order) await this.write(path, pending.get(path)!);
      if (!pending.has(last)) await this.write(last, await this.files.get(last)!.read());
      await this.reload();
      return pending.size;
    });
  }

  /** Writes a backup's files back, Player.save first and the current area's Containers.save last. The Cheated mark stays. */
  restore(backup: Backup): Promise<void> {
    return this.exclusive(async () => {
      await this.checkFresh();
      const root = this.character.root;
      if (backup.files.some((f) => !f.path.startsWith(root))) throw new Error("That backup belongs to another folder");
      const player = backup.files.find((f) => f.path === `${root}Player.save`);
      const last = currentContainers(
        this.files,
        root,
        parsePlayer(decodeJson(player?.bytes ?? await this.files.get(`${root}Player.save`)!.read())),
      );
      if (player) await this.write(player.path, player.bytes);
      for (const f of backup.files) if (f !== player && f.path !== last) await this.write(f.path, f.bytes);
      if (last) await this.write(last, backup.files.find((f) => f.path === last)?.bytes ?? await this.files.get(last)!.read());
      await this.reload();
    });
  }

  /** Rereads the folder after writing, dropping drafts. */
  private async reload() {
    const { scan, files } = await EditSession.open(this.dir);
    this.scan = scan;
    this.files = files;
    this.clear();
  }
}
export async function storeBackup(backup: Backup): Promise<void> {
  const db = await editorDb();
  try {
    const store = db.transaction(BACKUP_STORE, "readwrite").objectStore(BACKUP_STORE);
    await request(store.add(backup));
    const old = (await request(store.index("world").getAll(backup.world)) as Backup[]).sort((a, b) => b.at - a.at).slice(BACKUPS_KEPT);
    for (const b of old) await request(store.delete(b.id!));
  } finally {
    db.close();
  }
}

/** This world's backups, newest first. */
export async function listBackups(world: string): Promise<Backup[]> {
  const db = await editorDb();
  try {
    const all = await request(db.transaction(BACKUP_STORE).objectStore(BACKUP_STORE).index("world").getAll(world)) as Backup[];
    return all.sort((a, b) => b.at - a.at);
  } finally {
    db.close();
  }
}
