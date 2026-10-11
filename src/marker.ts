// MirkMap.ini: MirkMap's own notes in a character folder, next to Player.save. The game never reads, lists or removes it, and it
// travels with uploads (.ini is an allowed save file). One [MirkMap] section holds every feature's keys, e.g. from_share=1 on a
// world downloaded from a share link. Writers change only their own keys and keep every other line as it is.

import type { FileMap } from "./files.ts";

export const MARKER = "MirkMap.ini";
const SECTION = "mirkmap";
/** A real marker is a few lines; anything larger is not ours and is ignored. */
const MAX_MARKER = 64 * 1024;
const decoder = new TextDecoder();
const header = /^\s*\[([^\]]*)\]\s*$/;
const pair = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/;

/** The [MirkMap] keys, lower-cased; the last of duplicate keys wins. */
export function readMarker(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let inside = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const section = header.exec(line);
    if (section) inside = section[1].trim().toLowerCase() === SECTION;
    else if (inside) {
      const match = pair.exec(line);
      if (match) values.set(match[1].toLowerCase(), match[2]);
    }
  }
  return values;
}

export const markerFlag = (marker: Map<string, string>, key: string) => /^(1|true|yes)$/i.test(marker.get(key.toLowerCase()) ?? "");

/** Sets keys in [MirkMap], creating the file or section when missing; other sections, keys and comments are kept as they are. */
export function writeMarker(text: string | undefined, values: Record<string, string>): string {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Invalid ${MARKER} entry: ${key}`);
  }
  const eol = text?.includes("\r\n") || !text?.includes("\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : ["; MirkMap's notes about this world. The game ignores this file.", ""];
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const todo = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), `${key}=${value}`]));
  const missing = new Map(todo);
  // Like readMarker: every [MirkMap] section counts, and every copy of a key is replaced, so the value read back is the one written.
  let inside = false, last = -1;
  for (let i = 0; i < lines.length; i++) {
    const section = header.exec(lines[i]);
    if (section) {
      inside = section[1].trim().toLowerCase() === SECTION;
      if (inside) last = i;
    } else if (inside) {
      if (lines[i].trim()) last = i;
      const key = pair.exec(lines[i])?.[1].toLowerCase();
      if (key && todo.has(key)) {
        lines[i] = todo.get(key)!;
        missing.delete(key);
      }
    }
  }
  if (last < 0) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push("[MirkMap]", ...missing.values());
  } else lines.splice(last + 1, 0, ...missing.values());
  return lines.join(eol) + eol;
}

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
  return text !== undefined && markerFlag(readMarker(text), "from_share");
}
