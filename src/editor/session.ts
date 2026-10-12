// Save editor: one character folder opened for writing with the File System Access API (desktop Chrome and Edge). Edits change
// parsed copies of the save files (drafts) until they are saved. Saving refuses if the game wrote the folder since it was read, keeps
// the replaced files in this browser as a backup, writes the Cheated mark into MirkMap.json first and then each changed file the way
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

/**
 * An edit of one save file's draft: it changes the draft in place and returns a line for the list of unsaved changes, or undefined
 * when there was nothing to change. It reads only the draft (its inputs are fixed when it is made), so it can run again on a fresh
 * draft when an earlier change to the same file is undone.
 */
export type Edit = (raw: unknown) => string | undefined;

/** One unsaved change: the file it changes, its line in the list, and the edit itself. */
interface Change {
  path: string;
  note: string;
  edit: Edit;
}

/** Where a session keeps backups and its record of cheated worlds; this browser's IndexedDB unless a test passes its own. */
export interface SessionStore {
  backup(backup: Backup): Promise<void>;
  remember(world: string): Promise<void>;
}
const browserStore: SessionStore = { backup: (b) => storeBackup(b), remember: (w) => rememberCheated(w) };

export class EditSession {
  private drafts = new Map<string, unknown>();
  /** The unsaved changes, in the order they were made. */
  private log: Change[] = [];
  /** Edits and undos run one at a time, so a draft is never rebuilt while another edit is changing it. */
  private queue: Promise<unknown> = Promise.resolve();

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
      const value = decodeJson(await src.read());
      // Whoever finished reading first set the draft; everyone uses that one.
      if (!this.drafts.has(path)) this.drafts.set(path, value);
    }
    return this.drafts.get(path);
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Runs `edit` on the draft of `path` and records it as an unsaved change when it returns a note, which is also returned. An edit
   * that changes nothing or throws leaves the draft as the recorded changes made it.
   */
  apply(path: string, edit: Edit): Promise<string | undefined> {
    return this.serial(async () => {
      if (this.busy) throw new Error("Wait for the save to finish");
      const raw = await this.json(path);
      let note: string | undefined;
      try {
        note = edit(raw);
      } finally {
        if (note) this.log.push({ path, note, edit });
        else await this.rebuild(path, this.log);
      }
      return note;
    });
  }

  /**
   * Drops unsaved change `i` and runs the later changes to the same file again, on a fresh draft. A later change that no longer
   * applies (it throws, or changes nothing) is dropped too; their lines are returned. Changes to other files are untouched.
   */
  undo(i: number): Promise<string[]> {
    return this.serial(async () => {
      if (this.busy) throw new Error("Wait for the save to finish");
      const target = this.log[i];
      if (!target) throw new Error("That change was already undone");
      let rest = this.log.filter((_, j) => j !== i);
      const dropped: string[] = [];
      for (;;) {
        const failed = await this.rebuild(target.path, rest);
        if (failed === undefined) return dropped;
        dropped.push(failed.note);
        rest = rest.filter((c) => c !== failed);
      }
    });
  }

  /**
   * Parses `path` afresh and runs `changes`' edits to it again, recording the lines they give now. Stops at the first edit that no
   * longer applies and returns it, leaving the log as it was; otherwise the log becomes `changes`.
   */
  private async rebuild(path: string, changes: Change[]): Promise<Change | undefined> {
    this.drafts.delete(path);
    const raw = await this.json(path);
    const next: Change[] = [];
    for (const c of changes) {
      if (c.path !== path) {
        next.push(c);
        continue;
      }
      let note: string | undefined;
      try {
        note = c.edit(raw);
      } catch {
        note = undefined;
      }
      if (!note) return c;
      next.push({ ...c, note });
    }
    this.log = next;
  }

  get changes(): readonly string[] {
    return this.log.map((c) => c.note);
  }

  /** Files with unsaved changes. */
  private get dirty(): Set<string> {
    return new Set(this.log.map((c) => c.path));
  }

  /** The files as saving would leave them: each changed draft encoded as it would be written, every other file as it was read. */
  preview(): FileMap {
    const out: FileMap = new Map(this.files);
    for (const path of this.dirty) {
      const bytes = encodeSave(this.drafts.get(path));
      out.set(path, { read: () => Promise.resolve(bytes), lastModified: this.files.get(path)?.lastModified });
    }
    return out;
  }

  discard() {
    if (this.busy) throw new Error("Wait for the save to finish");
    this.clear();
  }
  private clear() {
    this.drafts.clear();
    this.log = [];
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
    const changes = [...this.changes];
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
