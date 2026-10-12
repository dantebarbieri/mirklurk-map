// MirkMap.json: MirkMap's own notes in a character folder, next to Player.save. The game never reads, lists or removes it, and it
// travels with uploads. One JSON object holds every feature's keys, e.g. "fromShare": true on a world downloaded from a share link.
// Writers change only their own keys and keep every other one. It is JSON rather than INI because Chrome and Edge on Windows refuse
// .ini files in the File System Access API (Safe Browsing lists .ini as dangerous there), which the save editor writes with.

import type { FileMap } from "./files.ts";
import { isRec, type Rec } from "./save-record.ts";

export const MARKER = "MirkMap.json";
/** A real marker is a few lines; anything larger is not ours and is ignored. */
const MAX_MARKER = 64 * 1024;
const ABOUT = "MirkMap's notes about this world. The game ignores this file.";
const decoder = new TextDecoder();

export type Notes = Rec;

/** The notes in a MirkMap.json's text; text that is not a JSON object has none. */
export function readMarker(text: string): Notes {
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    return isRec(value) ? value : {};
  } catch {
    return {};
  }
}

/** Sets keys in the notes, creating them when missing; every other key is kept as it is. */
export function writeMarker(text: string | undefined, values: Notes): string {
  const notes = text === undefined ? { about: ABOUT } : readMarker(text);
  return `${JSON.stringify({ ...notes, ...values }, null, 2)}\n`;
}

/** Whether `path` is a file MirkMap reads and carries: the game's saves, tile maps, .ini files and map images, and MirkMap.json. */
export const isSaveFile = (path: string) => /\.(save|tmap|png|ini)$/i.test(path) || /(^|\/)mirkmap\.json$/i.test(path);

/** The marker file of the character at `root` (any letter case, as on Windows), if it has one. */
export function markerPath(files: FileMap, root: string): string | undefined {
  const want = `${root}${MARKER}`.toLowerCase();
  for (const path of files.keys()) if (path.length === want.length && path.toLowerCase() === want) return path;
}

export async function markerText(files: FileMap, root: string): Promise<string | undefined> {
  const path = markerPath(files, root);
  if (!path) return undefined;
  const bytes = await files.get(path)!.read();
  return bytes.length <= MAX_MARKER ? decoder.decode(bytes) : undefined;
}

/** The world came from a share link (MirkMap shows it as "(From Share)" with an S badge). */
export async function isFromShare(files: FileMap, root: string): Promise<boolean> {
  const text = await markerText(files, root);
  return text !== undefined && readMarker(text).fromShare === true;
}
