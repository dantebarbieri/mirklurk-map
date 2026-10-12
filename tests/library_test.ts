// The library this browser keeps (src/library.ts): its key, and finding the library a world was opened from among those kept.

import { assertEquals } from "./assert.ts";
import { LIBRARY_STORAGE, libraryKey, libraryKeyFor } from "../src/library.ts";
import { libraryId, newToken } from "../src/sharing-format.ts";

Deno.test("library: the key in use, and a world's library found among the ones this browser keeps", async () => {
  const before = localStorage.getItem(LIBRARY_STORAGE);
  try {
    localStorage.removeItem(LIBRARY_STORAGE);
    assertEquals(libraryKey(), undefined, "no library yet");
    const current = newToken(), saved = newToken(), gone = newToken();
    localStorage.setItem(
      LIBRARY_STORAGE,
      JSON.stringify({ current: { key: current, name: "" }, saved: [{ key: saved, name: "Old" }, { key: "not a key", name: "" }] }),
    );
    assertEquals(libraryKey(), current);
    assertEquals(await libraryKeyFor(await libraryId(current)), current);
    assertEquals(await libraryKeyFor(await libraryId(saved)), saved, "a library switched away from is still kept");
    assertEquals(await libraryKeyFor(await libraryId(gone)), undefined);
    localStorage.setItem(LIBRARY_STORAGE, "{");
    assertEquals(libraryKey(), undefined, "unreadable storage");
  } finally {
    if (before === null) localStorage.removeItem(LIBRARY_STORAGE);
    else localStorage.setItem(LIBRARY_STORAGE, before);
  }
});
