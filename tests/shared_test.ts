// Helpers shared by the tools (tools/shared.ts).

import { assert, assertEquals, assertRejects } from "./assert.ts";
import { concat, contentHash, removeTree, saveRequest } from "../tools/shared.ts";

Deno.test("dev saves: a request names a character and a file inside that character's folder", () => {
  assertEquals(saveRequest("/__saves/Hero/Player.save"), { character: "Hero", file: "Player.save" });
  assertEquals(saveRequest("/__saves/Hero/[ 1,0 ]/Containers.save"), { character: "Hero", file: "[ 1,0 ]/Containers.save" });
  assertEquals(saveRequest("/__saves/Hero/"), { character: "Hero", file: "" }, "the folder's listing");
  assertEquals(saveRequest("/__saves/Hero/notes..txt"), { character: "Hero", file: "notes..txt" }, "dots inside a name are no step up");
  for (
    const path of [
      "/__saves/Hero",
      "/__saves/../Hero/Player.save",
      "/__saves/Hero/../Other/Player.save",
      "/__saves/Hero/a/../../Other/Player.save",
      // A decoded %5C: Windows reads a backslash as a separator too.
      "/__saves/Hero/..\\..\\Other\\Player.save",
      "/__saves/Hero/sub\\..\\..\\Other\\Player.save",
      "/__saves/..\\Hero/Player.save",
      "/index.html",
    ]
  ) assertEquals(saveRequest(path), undefined, path);
});

Deno.test("removeTree removes a folder and what is in it, is quiet when it is gone, and reports any other failure", async () => {
  const dir = await Deno.makeTempDir({ prefix: "mirklurk-tools-" });
  try {
    await Deno.mkdir(`${dir}/out/sub`, { recursive: true });
    await Deno.writeTextFile(`${dir}/out/sub/file.txt`, "x");
    await removeTree(`${dir}/out`);
    await assertRejects(() => Deno.stat(`${dir}/out`), /./);
    await removeTree(`${dir}/out`);
    // No file name may contain a NUL character, so this fails for a reason other than being missing.
    await assertRejects(() => removeTree(`${dir}/a\0b`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("concat joins byte arrays in order; contentHash is the first 5 bytes of the SHA-256 in hex", async () => {
  assertEquals([...concat(new Uint8Array([1, 2]), new Uint8Array(), new Uint8Array([3]))], [1, 2, 3]);
  assertEquals(await contentHash(new TextEncoder().encode("abc")), "ba7816bf8f");
  assert((await contentHash(new Uint8Array())).length === 10);
});
