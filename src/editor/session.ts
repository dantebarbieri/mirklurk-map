// Save editor: one character's save, from wherever it was opened: a folder of the game's files (written with the File System Access
// API, desktop Chrome and Edge), a world in My worlds (updated through the library API), or a copy (a .zip, a folder read without
// write access, or what MirkMap handed over), which is downloaded or saved into the game's folder chosen then. Edits change parsed
// copies of the save files (drafts) until they are saved; reloading reads the save again and runs them again on it. Saving refuses
// if the save changed since it was read, keeps the replaced files in this browser as a backup, writes the Cheated mark into
// MirkMap.json first and then each changed file the way save_datajson does: JSON and one NUL byte.

import { type Character, type FileMap, findCharacters, named } from "../files.ts";
import { captureSnapshot, currentContainers, type LiveDirectory, type LiveFile, type Scan, scanDirectory } from "../live.ts";
import { MARKER, markerPath, markerText } from "../marker.ts";
import { BACKUP_STORE, editorDb, markCheated, rememberCheated, request } from "../cheated.ts";
import { decodeJson, parsePlayer } from "../save.ts";
import { MAX_UPLOAD, packSave, unpackSave, type WorldInfo } from "../sharing-format.ts";
import { ShareError } from "../library.ts";
import { type SaveDownload, saveZip } from "../download.ts";

export interface EditDirectory extends LiveDirectory {
  values(): AsyncIterable<EditDirectory | EditFile>;
  getDirectoryHandle(name: string): Promise<EditDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<EditFile>;
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
export interface EditFile extends LiveFile {
  createWritable(): Promise<{ write(data: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }>;
}
export interface WritablePicker {
  showDirectoryPicker?(options: { mode: "readwrite"; id?: string }): Promise<EditDirectory>;
}

/** Whether this browser can write to a folder the user chooses (desktop Chrome and Edge); every other source works anywhere. */
export const canWriteFolders = () => typeof (globalThis as WritablePicker).showDirectoryPicker === "function" && globalThis.isSecureContext;

/** One saved edit session's replaced files, kept in this browser. */
export interface Backup {
  id?: number;
  world: string;
  character: string;
  /** The character's root that the files' paths start with; restoring puts them under the root the save has then. */
  root?: string;
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

/** One read of a save: its files, the characters in them, and the source's note of their version for telling when it changed. */
export interface SaveRead {
  files: FileMap;
  characters: Character[];
  version?: unknown;
}

/** One file a save writes. */
export interface Write {
  path: string;
  bytes: Uint8Array;
}

/** Where a session's save comes from, and goes back to. */
export interface SaveSource {
  /** A folder of the game's files, a world in My worlds, or a copy that can only be downloaded or saved into a folder. */
  readonly kind: "folder" | "library" | "copy";
  read(): Promise<SaveRead>;
  /** Throws a StaleError if the character's save changed since `read`. */
  check(read: SaveRead, character: Character): Promise<void>;
  /**
   * Writes `writes` in their order; `all` is every file of the save once they are written, and `read` the save they replace. Returns
   * the save as it is then.
   */
  write(writes: Write[], all: FileMap, character: Character, read: SaveRead): Promise<SaveRead>;
}

/** A folder opened with the File System Access API: the whole Saves folder or one character's folder. */
export class FolderSource implements SaveSource {
  readonly kind = "folder";
  constructor(readonly dir: EditDirectory) {}

  /** Reads the folder (any depth), with Live saves' checks that no save is half written. */
  async read(): Promise<SaveRead> {
    const scan = await scanDirectory(this.dir);
    const { files } = await captureSnapshot(scan);
    return { files, characters: findCharacters(files), version: scan };
  }

  async check(read: SaveRead, character: Character) {
    const before = read.version as Scan;
    const now = await scanDirectory(this.dir);
    const root = character.root;
    const differs = [...new Set([...before.entries.keys(), ...now.entries.keys()])].filter((path) =>
      path.startsWith(root) && before.entries.get(path)?.stamp !== now.entries.get(path)?.stamp
    );
    if (differs.length) {
      throw new StaleError(
        `The game changed ${
          differs.length === 1 ? differs[0].slice(root.length) : `${differs.length} files`
        } since this folder was read. ` +
          "Choose Reload save to read the newest save and run your unsaved changes again on it.",
      );
    }
  }

  /** Whether the folder may be read (`readwrite`: also written). Asking, when it may not be yet, needs a click on the page. */
  async allowed(mode: "read" | "readwrite", ask: boolean): Promise<boolean> {
    if (!this.dir.queryPermission) return true;
    if (await this.dir.queryPermission({ mode }) === "granted") return true;
    return ask && !!this.dir.requestPermission && await this.dir.requestPermission({ mode }) === "granted";
  }

  async write(writes: Write[]): Promise<SaveRead> {
    for (const { path, bytes } of writes) {
      const out = await (await this.handle(path)).createWritable();
      await out.write(bytes as BufferSource);
      await out.close();
    }
    return this.read();
  }

  private async handle(path: string): Promise<EditFile> {
    const parts = path.split("/");
    if (parts[0] !== this.dir.name) throw new Error(`${path} is outside the opened folder`);
    let dir = this.dir;
    for (const part of parts.slice(1, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1], { create: true });
  }
}

/** The library calls a LibrarySource makes: src/library.ts's api with this browser's key, or a stand-in server in tests. */
export type LibraryCall = (path: string, init?: RequestInit) => Promise<Response>;

const STALE_LIBRARY = "This world was updated in My worlds since it was read, from another device or by Live saves keeping it updated. " +
  "Choose Reload save to read the newest version and run your unsaved changes again on it.";

/** A world in My worlds: read from the library, and saved by updating it there, which every synced device then sees. */
export class LibrarySource implements SaveSource {
  readonly kind = "library";
  /** `library`: the ID of the library the world is in (libraryId of the key `call` uses), to open it from there again. */
  constructor(readonly id: string, private call: LibraryCall, readonly library = "") {}

  private async data(init?: RequestInit): Promise<Response> {
    try {
      return await this.call(`/library/worlds/${this.id}/data`, init);
    } catch (e) {
      if (e instanceof ShareError && e.status === 404) {
        throw new Error("This world is no longer in My worlds: it was deleted, or it expired");
      }
      throw e;
    }
  }

  async read(): Promise<SaveRead> {
    const response = await this.data();
    const length = response.headers.get("Content-Length");
    if (length && Number(length) > MAX_UPLOAD) {
      await response.body?.cancel();
      throw new Error("This world is too large");
    }
    const { name, files } = unpackSave(new Uint8Array(await response.arrayBuffer()));
    return { files, characters: [{ name, root: "Shared/" }], version: response.headers.get("ETag") ?? undefined };
  }

  async check(read: SaveRead) {
    const response = await this.data({ headers: typeof read.version === "string" ? { "If-None-Match": read.version } : {} });
    if (response.status === 304) return;
    await response.body?.cancel();
    throw new StaleError(STALE_LIBRARY);
  }

  async write(_writes: Write[], all: FileMap, character: Character, read: SaveRead): Promise<SaveRead> {
    const body = await packSave(all, character);
    // If-Match only updates, so a world deleted on another device is never quietly added back; the version read (its ETag) also
    // refuses to overwrite an update another device made since, even one that lands right after `check`.
    const match = typeof read.version === "string" ? read.version : "*";
    let info: WorldInfo;
    try {
      const response = await this.call(`/library/worlds/${this.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "If-Match": match },
        body: body as BodyInit,
      });
      info = await response.json();
    } catch (e) {
      if (e instanceof ShareError && e.status === 412) {
        // Deleted or updated meanwhile: reading it again tells which (check throws for both).
        if (match !== "*") {
          await this.check(read);
          throw new StaleError(STALE_LIBRARY);
        }
        throw new Error("This world is no longer in My worlds: it was deleted on another device, or it expired. Download it instead");
      }
      throw e;
    }
    return { files: all, characters: [character], version: `"${info.version}"` };
  }
}

/** A copy held in this tab (a .zip, a folder read without write access, or what MirkMap handed over). It is never written. */
export class CopySource implements SaveSource {
  readonly kind = "copy";
  private characters: Character[];
  /** `label`: where the copy came from, such as the .zip's name. `known`: a character whose folder does not name it (see `named`). */
  constructor(private files: FileMap, readonly label: string, known?: Character) {
    this.characters = named(findCharacters(files), known);
  }

  /** Copies every file's bytes now, so the game saving meanwhile can neither change nor break what is being edited. */
  static async of(files: FileMap, label: string): Promise<CopySource> {
    const fixed: FileMap = new Map();
    for (const [path, source] of files) {
      const bytes = await source.read();
      fixed.set(path, { read: () => Promise.resolve(bytes), lastModified: source.lastModified });
    }
    return new CopySource(fixed, label);
  }

  read(): Promise<SaveRead> {
    return Promise.resolve({ files: this.files, characters: this.characters });
  }
  check(): Promise<void> {
    return Promise.resolve();
  }
  write(): Promise<SaveRead> {
    return Promise.reject(new Error("A copy is not saved in place: download it, or save it into the game's folder"));
  }
}

/**
 * An edit of one save file's draft: it changes the draft in place and returns a line for the list of unsaved changes, or undefined
 * when there was nothing to change. It reads only the draft (its inputs are fixed when it is made), so it can run again on a fresh
 * draft when an earlier change to the same file is undone, or when the save is reloaded after playing.
 */
export type Edit = (raw: unknown) => string | undefined;

/** One file's part of a change: the edit, and the line it gave when it last ran. */
interface Part {
  path: string;
  edit: Edit;
  note: string;
}

/**
 * One unsaved change: usually one file's edit, or several files' edits that only make sense together (moving yourself off a raft
 * and leaving the raft in its zone), which are undone, run again and dropped together. Its line joins its parts' lines.
 */
interface Change {
  id: number;
  parts: Part[];
  /** What the change set, such as one slider: a later change with the same key replaces it rather than adding another. */
  key?: string;
}
const noteOf = (c: Change) => c.parts.map((p) => p.note).join("; ");

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
  private nextId = 0;
  /** Edits and undos run one at a time, so a draft is never rebuilt while another edit is changing it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    /** Changes when a copy is saved into the game's folder. */
    public source: SaveSource,
    private read: SaveRead,
    /** Changes with the source: the character's folder can sit at another path in the folder chosen. */
    public character: Character,
    readonly world: string,
    private store: SessionStore = browserStore,
  ) {}

  /** The save's files as read. */
  get files(): FileMap {
    return this.read.files;
  }

  /** What went wrong after the last save went through (this browser's backup or Cheated record), if anything. */
  warning?: string;

  /** The save as last read or written. */
  get current(): SaveRead {
    return this.read;
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
  apply(path: string, edit: Edit, key?: string): Promise<string | undefined> {
    return this.applyAll([{ path, edit }], key);
  }

  /**
   * Runs several files' edits, in order, as one unsaved change, whose line (joining theirs) is returned. Unless every one of them
   * changes something, nothing is recorded and every draft is left as the recorded changes made it.
   *
   * `key` names what the change sets (one slider, one field): when the last change has the same key, this one replaces it, so
   * dragging a slider is one change, from where it started. Setting it back to where it started leaves no change at all; an edit
   * that throws leaves the last change in place.
   */
  applyAll(steps: { path: string; edit: Edit }[], key?: string): Promise<string | undefined> {
    return this.serial(async () => {
      if (this.busy) throw new Error("Wait for the save to finish");
      if (!steps.length) return undefined;
      for (const { path } of steps) if (!this.files.has(path)) throw new Error(`${path} is missing`);
      const last = this.log[this.log.length - 1];
      const replaced = key !== undefined && last?.key === key ? last : undefined;
      const touched = [...steps.map((s) => s.path), ...(replaced?.parts.map((p) => p.path) ?? [])];
      if (replaced) await this.replay(touched, this.log.slice(0, -1));
      const parts: Part[] = [];
      let failed = true;
      try {
        for (const { path, edit } of steps) {
          const raw = await this.json(path);
          const note = edit(raw);
          if (!note) break;
          parts.push({ path, edit, note });
        }
        failed = false;
      } finally {
        if (parts.length === steps.length) this.log.push({ id: this.nextId++, parts, ...(key === undefined ? {} : { key }) });
        else await this.replay(touched, failed && replaced ? [...this.log, replaced] : this.log);
      }
      return parts.length === steps.length ? noteOf(this.log[this.log.length - 1]) : undefined;
    });
  }

  /**
   * Drops unsaved change `i` and runs the later changes to the files it changed again, on fresh drafts. A later change that no
   * longer applies (it throws, or changes nothing) is dropped too; their lines are returned. Changes to other files are untouched.
   */
  undo(i: number): Promise<string[]> {
    return this.serial(async () => {
      if (this.busy) throw new Error("Wait for the save to finish");
      const target = this.log[i];
      if (!target) throw new Error("That change was already undone");
      const before = this.log;
      const dropped = await this.replay(target.parts.map((p) => p.path), before.filter((c) => c !== target));
      return before.filter((c) => dropped.has(c.id)).map(noteOf);
    });
  }

  /**
   * Takes the save as it is now (read again from its source, after playing in the game) and runs every unsaved change again on it,
   * in order, so saving checks against and writes over the newest save. A change that no longer applies (it throws, or now changes
   * nothing, such as setting wellbeing to 100% when the game already has it there) is dropped; their lines are returned. The others
   * stay, their lines written anew. If anything else goes wrong, the session is left as it was.
   *
   * `to` moves the session to another source, such as the game's folder a copy is saved into, where the character's folder may sit
   * at another path: the changes then edit the same files under its root.
   */
  rebase(read: SaveRead, to?: { source: SaveSource; character: Character }): Promise<string[]> {
    return this.serial(async () => {
      if (this.busy) throw new Error("Wait for the save to finish");
      const before = {
        read: this.read,
        source: this.source,
        character: this.character,
        drafts: new Map(this.drafts),
        log: this.log,
      };
      try {
        if (to) {
          const from = this.character.root, root = to.character.root;
          const moved = (path: string) => path.startsWith(from) ? root + path.slice(from.length) : path;
          this.log = this.log.map((c) => ({ ...c, parts: c.parts.map((p) => ({ ...p, path: moved(p.path) })) }));
          this.source = to.source;
          this.character = to.character;
        }
        this.read = read;
        const files = read.files;
        this.drafts.clear();
        const gone = new Set(this.log.filter((c) => c.parts.some((p) => !files.has(p.path))).map((c) => c.id));
        const kept = this.log.filter((c) => !gone.has(c.id));
        const dropped = await this.replay(kept.flatMap((c) => c.parts.map((p) => p.path)), kept);
        // In the order the changes were made, not file by file.
        return before.log.filter((c) => gone.has(c.id) || dropped.has(c.id)).map(noteOf);
      } catch (e) {
        Object.assign(this, before);
        throw e;
      }
    });
  }

  /**
   * Makes `changes` the log and builds the drafts of `paths` afresh from it. A change that no longer applies to one of them is
   * dropped, and every file it changed is built again without it. Returns the ids of the dropped changes.
   */
  private async replay(paths: Iterable<string>, changes: Change[]): Promise<Set<number>> {
    this.log = changes;
    const todo = new Set(paths);
    const dropped = new Set<number>();
    while (todo.size) {
      const path = todo.values().next().value!;
      const failed = await this.rebuild(path);
      if (!failed) {
        todo.delete(path);
        continue;
      }
      dropped.add(failed.id);
      this.log = this.log.filter((c) => c !== failed);
      for (const p of failed.parts) todo.add(p.path);
    }
    return dropped;
  }

  /**
   * Parses `path` afresh and runs the log's edits to it again, recording the lines they give now. Stops at the first change that no
   * longer applies and returns it, leaving the log as it was.
   */
  private async rebuild(path: string): Promise<Change | undefined> {
    this.drafts.delete(path);
    const raw = await this.json(path);
    const next: Change[] = [];
    for (const c of this.log) {
      if (!c.parts.some((p) => p.path === path)) {
        next.push(c);
        continue;
      }
      const parts: Part[] = [];
      for (const p of c.parts) {
        if (p.path !== path) {
          parts.push(p);
          continue;
        }
        let note: string | undefined;
        try {
          note = p.edit(raw);
        } catch {
          note = undefined;
        }
        if (!note) return c;
        parts.push({ ...p, note });
      }
      next.push({ ...c, parts });
    }
    this.log = next;
  }

  get changes(): readonly string[] {
    return this.log.map(noteOf);
  }

  /** Files with unsaved changes. */
  private get dirty(): Set<string> {
    return new Set(this.log.flatMap((c) => c.parts.map((p) => p.path)));
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

  /** The pending drafts, encoded as they would be written; encoded at once, so nothing done meanwhile changes what is written. */
  private pending(): Map<string, Uint8Array> {
    return new Map([...this.dirty].map((path) => [path, encodeSave(this.drafts.get(path))] as const));
  }

  /**
   * What saving `pending` writes, in the game's own order so readers that wait for a save to finish (Live saves) accept it: the
   * Cheated mark first (so an interrupted save is still marked), Player.save, then the other files, and the current area's
   * Containers.save last (rewritten as it is when it did not change).
   */
  private async plan(pending: Map<string, Uint8Array>): Promise<Write[]> {
    const root = this.character.root;
    const player = `${root}Player.save`;
    const playerBytes = pending.get(player) ?? await this.files.get(player)!.read();
    const last = currentContainers(this.files, root, parsePlayer(decodeJson(playerBytes)));
    if (!last) throw new Error("The player's area has no Containers.save; the game would not finish loading it");
    const marker = markerPath(this.files, root) ?? `${root}${MARKER}`;
    const order = [...pending.keys()].sort((a, b) =>
      Number(b === player) - Number(a === player) || Number(a === last) - Number(b === last)
    );
    return [
      { path: marker, bytes: encoder.encode(markCheated(await markerText(this.files, root))) },
      ...order.map((path) => ({ path, bytes: pending.get(path)! })),
      ...(pending.has(last) ? [] : [{ path: last, bytes: await this.files.get(last)!.read() }]),
    ];
  }

  /** Every file once `writes` are written, each written one dated in the order written, as the game's own save would be. */
  private after(writes: Write[]): FileMap {
    const all: FileMap = new Map(this.files);
    const now = Date.now();
    writes.forEach(({ path, bytes }, i) => all.set(path, { read: () => Promise.resolve(bytes), lastModified: now + i }));
    return all;
  }

  /**
   * Saves every changed draft to the source (see `plan` for the order), once the source confirms the save did not change since it
   * was read, keeping the replaced files as a backup, and drops the drafts after. Returns the number of changed files.
   */
  save(): Promise<number> {
    if (!this.dirty.size) return Promise.resolve(0);
    if (this.source.kind === "copy") return Promise.reject(new Error("Choose where to save this copy first"));
    const pending = this.pending();
    const changes = [...this.changes];
    return this.exclusive(async () => {
      this.warning = undefined;
      const { source, character } = this;
      await source.check(this.read, character);
      const writes = await this.plan(pending);
      const backup: Backup = { world: this.world, character: character.name, root: character.root, at: Date.now(), changes, files: [] };
      for (const path of pending.keys()) backup.files.push({ path, bytes: await this.files.get(path)!.read() });
      // A folder is written file by file, so an interrupted save is backed up and marked first. An upload to My worlds goes through
      // whole or not at all (the library refuses updates closer than 30 seconds apart), so it is backed up once it went through.
      const whole = source.kind === "library";
      if (!whole) {
        await this.store.backup(backup);
        await this.store.remember(this.world);
      }
      this.read = await source.write(writes, this.after(writes), character, this.read);
      this.clear();
      if (whole) {
        // The world is saved by now: if this browser can't record it, say so rather than report the save as failed.
        try {
          await this.store.remember(this.world);
          await this.store.backup(backup);
        } catch (e) {
          this.warning = `This browser could not keep its backup of the replaced files or its Cheated record: ${(e as Error).message}`;
        }
      }
      return pending.size;
    });
  }

  /**
   * The save as saving would leave it, Cheated mark and all, as a .zip for the game's Saves folder. The unsaved changes stay unsaved
   * (saving them elsewhere is still possible), but this browser remembers the world as cheated, as it does when they are saved.
   */
  async download(): Promise<SaveDownload> {
    const pending = this.pending();
    let files = this.files;
    if (pending.size) {
      files = this.after(await this.plan(pending));
      await this.store.remember(this.world);
    }
    return saveZip(this.character.name, files, this.character.root);
  }

  /** Writes a backup's files back, Player.save first and the current area's Containers.save last. The Cheated mark stays. */
  restore(backup: Backup): Promise<void> {
    return this.exclusive(async () => {
      const { source, character } = this;
      await source.check(this.read, character);
      const root = character.root, from = backup.root ?? root;
      if (backup.files.some((f) => !f.path.startsWith(from))) throw new Error("That backup belongs to another folder");
      const files = backup.files.map((f) => ({ path: root + f.path.slice(from.length), bytes: f.bytes }));
      const player = files.find((f) => f.path === `${root}Player.save`);
      const last = currentContainers(
        this.files,
        root,
        parsePlayer(decodeJson(player?.bytes ?? await this.files.get(`${root}Player.save`)!.read())),
      );
      const writes: Write[] = [
        ...(player ? [player] : []),
        ...files.filter((f) => f !== player && f.path !== last),
        ...(last ? [{ path: last, bytes: files.find((f) => f.path === last)?.bytes ?? await this.files.get(last)!.read() }] : []),
      ];
      this.read = await source.write(writes, this.after(writes), character, this.read);
      this.clear();
    });
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
