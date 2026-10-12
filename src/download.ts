// Downloads a world as a save the game can load: a ZIP whose root is the character's folder, ready for the game's Saves folder.

import type { FileMap } from "./files.ts";
import { MARKER, markerPath, markerText, writeMarker } from "./marker.ts";
import { writeZip, type ZipInput } from "./zip.ts";

/**
 * The game names a character after its folder in Saves, so the folder keeps the world's name. Names Windows can't use as a folder
 * (only possible from a save copied off another system) get their invalid characters replaced.
 */
export function folderName(name: string): string {
  const safe = [...name].map((c) => c < " " || '<>:"/\\|?*'.includes(c) ? "_" : c).join("").replace(/[. ]+$/, "");
  if (!safe) return "Character";
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(safe) ? `_${safe}` : safe;
}

export interface SaveDownload {
  blob: Blob;
  /** The ZIP's file name. */
  filename: string;
  /** The character folder at the ZIP's root, which is also the character's name in game. */
  folder: string;
}

/**
 * Every file of the character at `root`, byte-for-byte with its saved time. A world from a share link (`share` is when it was
 * downloaded) also gets "fromShare": true in MirkMap.json, keeping that file's other keys. MirkMap.json is hidden on Windows.
 */
export async function saveZip(name: string, files: FileMap, root: string, share?: Date): Promise<SaveDownload> {
  const folder = folderName(name);
  const marker = markerPath(files, root);
  const entries: ZipInput[] = [];
  for (const [path, source] of files) {
    if (!path.startsWith(root) || path === marker) continue;
    entries.push({ name: `${folder}/${path.slice(root.length)}`, data: await source.read(), modified: source.lastModified });
  }
  if (!entries.length) throw new Error("This world has no files to download");
  const text = await markerText(files, root);
  if (share) {
    const values = { fromShare: true, shareDownloaded: share.toISOString().replace(/\.\d+Z$/, "Z") };
    entries.push({
      name: `${folder}/${MARKER}`,
      data: new TextEncoder().encode(writeMarker(text, values)),
      modified: +share,
      hidden: true,
    });
  } else if (marker) {
    const source = files.get(marker)!;
    entries.push({
      name: `${folder}/${marker.slice(root.length)}`,
      data: await source.read(),
      modified: source.lastModified,
      hidden: true,
    });
  }
  return { blob: await writeZip(entries), filename: `${folder}${share ? " (From Share)" : ""}.zip`, folder };
}

/** Hands a download to the browser; the blob: URL needs no network and stays within the page's Content-Security-Policy. */
export function offerDownload({ blob, filename }: SaveDownload) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
