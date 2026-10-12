import { type FileMap, filesIn, findCharacters, type Source } from "./files.ts";
import { parseItemList } from "./inventory.ts";
import { isSaveFile } from "./marker.ts";
import { centerpos, isOutside, isRiftDepths } from "./rules.ts";
import {
  decodeHeights,
  decodeJson,
  decodeTilemap,
  parseAreaDir,
  parseContainers,
  parsePlayer,
  parseTrees,
  type PlayerSave,
} from "./save.ts";

// Structural types keep the optional picker usable without requiring it in every browser.
export interface LiveDirectory {
  kind: "directory";
  name: string;
  values(): AsyncIterable<LiveDirectory | LiveFile>;
}
export interface LiveFile {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
export interface DirectoryPicker {
  showDirectoryPicker?(options: { mode: "read" }): Promise<LiveDirectory>;
}
declare global {
  interface Window extends DirectoryPicker {}
}
interface Entry {
  file: File;
  stamp: string;
}
export interface Scan {
  entries: Map<string, Entry>;
  signature: string;
}
export interface Snapshot {
  files: FileMap;
  scan: Scan;
}

export async function scanDirectory(dir: LiveDirectory): Promise<Scan> {
  const entries = new Map<string, Entry>();
  for await (const [path, handle] of filesIn(dir)) {
    if (!isSaveFile(handle.name)) continue;
    const file = await handle.getFile();
    entries.set(path, { file, stamp: `${file.lastModified}:${file.size}` });
  }
  const signature = JSON.stringify([...entries].map(([path, e]) => [path, e.stamp]).sort(([a], [b]) => a.localeCompare(b)));
  return { entries, signature };
}

function validate(path: string, bytes: Uint8Array) {
  if (path.endsWith("Ygrid.save")) decodeHeights(bytes);
  else if (path.endsWith(".tmap")) decodeTilemap(bytes);
  else if (path.endsWith(".save")) {
    if (!bytes.length) throw new Error(`${path} is empty (a save may be in progress)`);
    const raw = decodeJson(bytes);
    if (!Array.isArray(raw)) throw new Error(`${path} is not a saved list`);
    if (path.endsWith("/Player.save")) parsePlayer(raw);
    else if (path.endsWith("/Containers.save")) parseContainers(raw);
    else if (path.endsWith("/Trees.save")) parseTrees(raw);
    else if (/\/LOOT-[^/]+\.save$/.test(path)) parseItemList(raw);
  } else if (path.endsWith(".png")) {
    const end = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
    if (bytes[0] !== 137 || bytes[1] !== 80 || !end.every((b, i) => bytes[bytes.length - 12 + i] === b)) {
      throw new Error(`${path} is an incomplete PNG`);
    }
  }
}

/** The Containers.save of the area the player was saved in: the game writes it last when it saves (Player.save on step 1). */
export function currentContainers(files: FileMap, root: string, p: PlayerSave): string | undefined {
  return [...files.keys()].find((path) => {
    if (!path.startsWith(root) || !path.endsWith("/Containers.save")) return false;
    const folder = path.slice(root.length).split("/");
    if (folder.length !== 2) return false;
    if (isRiftDepths(p.area.type)) return folder[0] === `RW${p.area.type - 23}`;
    const at = parseAreaDir(folder[0]);
    return at && at[0] === p.area.x && at[1] === p.area.y &&
      (isOutside(p.area.type)
        ? at.length === 2
        : at.length === 4 && at[2] === centerpos(p.entrance[0]) && at[3] === centerpos(p.entrance[1]));
  });
}

/** Retain immutable bytes, not File objects that become unreadable after external writes. */
export async function captureSnapshot(scan: Scan, previous?: Snapshot): Promise<Snapshot> {
  const files: FileMap = new Map();
  for (const [path, entry] of scan.entries) {
    const old = previous?.scan.entries.get(path);
    let source: Source | undefined = old?.stamp === entry.stamp ? previous?.files.get(path) : undefined;
    if (!source) {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      validate(path, bytes);
      source = { read: () => Promise.resolve(bytes), lastModified: entry.file.lastModified };
    }
    files.set(path, source);
  }
  const characters = findCharacters(files);
  if (!characters.length) throw new Error("No Player.save found. Choose a character folder or the Saves folder.");
  for (const c of characters) {
    const playerFile = files.get(`${c.root}Player.save`)!;
    const containers = currentContainers(files, c.root, parsePlayer(decodeJson(await playerFile.read())));
    // Player is written on step 1, current-area containers last on step 19.
    if (!containers || (files.get(containers)!.lastModified ?? 0) < (playerFile.lastModified ?? 0)) {
      throw new Error(`${c.name}: waiting for the current area's Containers.save to finish after Player.save`);
    }
  }
  return { files, scan };
}

/** One poll at a time; publish only after a quiet interval and an unchanged post-read scan. */
export class LiveReader {
  private candidate?: string;
  private since = 0;
  private accepted?: Snapshot;
  private stopped = false;
  private busy = false;
  constructor(
    private scan: () => Promise<Scan>,
    private publish: (snapshot: Snapshot) => Promise<boolean>,
    private report: (message: string, error: boolean) => void,
    private now = () => Date.now(),
  ) {}

  stop() {
    this.stopped = true;
    this.accepted = undefined;
  }

  async poll() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const scan = await this.scan();
      if (this.stopped) return;
      if (scan.signature === this.accepted?.scan.signature) {
        this.candidate = undefined;
        this.report("Watching for saved changes. Movement between saves is not tracked.", false);
        return;
      }
      if (scan.signature !== this.candidate) {
        this.candidate = scan.signature;
        this.since = this.now();
      }
      if (this.now() - this.since < 1500) {
        this.report("Waiting for save writes to settle; keeping the last snapshot.", false);
        return;
      }
      const snapshot = await captureSnapshot(scan, this.accepted);
      if (this.stopped) return;
      const after = await this.scan();
      if (this.stopped) return;
      if (after.signature !== scan.signature) {
        this.candidate = after.signature;
        this.since = this.now();
        this.report("Save changed while reading; waiting before retrying.", false);
        return;
      }
      if (await this.publish(snapshot) && !this.stopped) {
        this.accepted = snapshot;
        this.report("Watching for saved changes. Movement between saves is not tracked.", false);
      }
    } catch (e) {
      if (this.stopped) return;
      console.error(e);
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      this.report(
        denied
          ? "Folder access lost. Stop live saves and choose the folder again. Last snapshot retained."
          : `Could not refresh: ${(e as Error).message}. Retaining the last snapshot; will retry.`,
        true,
      );
    } finally {
      this.busy = false;
    }
  }
}
