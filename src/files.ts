// Turns picked folders, dropped folders or a ZIP into a flat path -> file map.

import { readZip } from "./zip.ts";
import type { LiveDirectory } from "./live.ts";

export interface Source {
  read(): Promise<Uint8Array>;
  lastModified?: number;
}
export type FileMap = Map<string, Source>;

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");

const fileSource = (f: Blob): Source => ({
  read: async () => new Uint8Array(await f.arrayBuffer()),
  lastModified: f instanceof File ? f.lastModified : undefined,
});

async function addZip(map: FileMap, file: Blob, prefix = "") {
  for (const e of await readZip(file)) map.set(norm(prefix + e.name), e);
}

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip";

/** Files from <input type=file> (with or without webkitdirectory). */
export async function fromFiles(files: Iterable<File>): Promise<FileMap> {
  const map: FileMap = new Map();
  for (const f of files) {
    if (isZip(f)) await addZip(map, f);
    else map.set(norm(f.webkitRelativePath || f.name), fileSource(f));
  }
  return map;
}

// Minimal typings for the (widely supported) File and Directory Entries API.
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?(ok: (f: File) => void, err: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (e: FsEntry[]) => void, err: (e: unknown) => void): void };
}

async function walk(entry: FsEntry, map: FileMap): Promise<void> {
  if (entry.isFile && entry.file) {
    const f = await new Promise<File>((ok, err) => entry.file!(ok, err));
    if (isZip(f)) await addZip(map, f);
    else map.set(norm(entry.fullPath), fileSource(f));
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, map);
    }
  }
}

/** Dropped files and folders. */
export async function fromDataTransfer(dt: DataTransfer): Promise<FileMap> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const e = (item as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  if (entries.length === 0) return fromFiles(Array.from(dt.files));
  const map: FileMap = new Map();
  for (const e of entries) await walk(e, map);
  return map;
}

/** Every file of a folder handle (a folder chosen with the directory picker), under the folder's name as a picked folder has them. */
export async function fromDirectory(dir: LiveDirectory): Promise<FileMap> {
  const map: FileMap = new Map();
  async function walk(folder: LiveDirectory, prefix: string) {
    for await (const handle of folder.values()) {
      if (handle.kind === "directory") await walk(handle, `${prefix}${handle.name}/`);
      else map.set(prefix + handle.name, fileSource(await handle.getFile()));
    }
  }
  await walk(dir, `${dir.name}/`);
  return map;
}

export interface Character {
  name: string;
  /** Path prefix ending in "/" (or "" when Player.save was picked on its own). */
  root: string;
}

/** A character can have a different root when switching between its folder and the whole Saves folder. */
export function characterIndex(characters: Character[], selected?: Character): number {
  const exact = characters.findIndex((c) => c.root === selected?.root);
  return exact >= 0 ? exact : Math.max(0, characters.findIndex((c) => c.name === selected?.name));
}

/**
 * The characters, with `known`'s name for the one at its root: a world from My worlds or a share link sits under "Shared/", and a
 * Player.save picked on its own under no folder, so their folder does not name them.
 */
export const named = (characters: Character[], known?: Character): Character[] =>
  characters.map((c) => known && c.root === known.root ? { ...c, name: known.name } : c);

/** Every folder that contains a Player.save is a character (Saves/<name>/Player.save). */
export function findCharacters(files: FileMap): Character[] {
  const out: Character[] = [];
  for (const path of files.keys()) {
    const m = /^(.*\/)?Player\.save$/.exec(path);
    if (!m) continue;
    const root = m[1] ?? "";
    const name = root.replace(/\/$/, "").split("/").pop() || "Character";
    out.push({ name, root });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
