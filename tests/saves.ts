// Real saves, for the tests that check against them when there are some (those tests are skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test      (defaults to ../Saves next to this folder)
// Tests only read these; a test that writes copies a character to a temporary folder first.

import type { FileMap } from "../src/files.ts";

/** The game's Saves folder: MIRKLURK_SAVES, or ../Saves next to this checkout. */
export const SAVES = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

/** Whether there are saves to check against. */
export const HAVE_SAVES = (() => {
  try {
    return Deno.statSync(SAVES).isDirectory;
  } catch {
    return false;
  }
})();

/** Every file under folder `root`, as a FileMap with paths under `prefix`; each file is read when asked for. */
export function readTree(root = SAVES, prefix = "Saves/", out: FileMap = new Map()): FileMap {
  for (const e of Deno.readDirSync(root)) {
    const path = `${root}/${e.name}`;
    if (e.isDirectory) readTree(path, `${prefix}${e.name}/`, out);
    else out.set(`${prefix}${e.name}`, { read: () => Deno.readFile(path) });
  }
  return out;
}
