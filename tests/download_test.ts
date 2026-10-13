// Downloading a world as a save the game can load: ZIP writing, the MirkMap.json marker, and byte-for-byte round trips.
//   MIRKLURK_SAVES="…\Saves" deno task test      (the real-save round trip is skipped when no saves are found)

import { assert, assertEquals, assertRejects } from "./assert.ts";
import { HAVE_SAVES, SAVES } from "./saves.ts";
import { type FileMap, findCharacters, fromFiles } from "../src/files.ts";
import { isFromShare, isSaveFile, MARKER, readMarker, writeMarker } from "../src/marker.ts";
import { folderName, saveZip } from "../src/download.ts";
import { MAX_UPLOAD, newToken, packSave, unpackSave, worldId } from "../src/sharing-format.ts";
import { crc32, readZip, writeZip } from "../src/zip.ts";
import { loadWorld } from "../src/world.ts";
import { decodeJson, parsePlayer } from "../src/save.ts";
import { UploadStore } from "../server/uploads.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const grid = Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]);
const player = encode(JSON.stringify([{ worldGrid: grid }]));
const source = (bytes: Uint8Array, lastModified?: number) => ({ read: () => Promise.resolve(bytes), lastModified });

async function unzip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const entry of await readZip(blob)) out.set(entry.name, await entry.read());
  return out;
}

/** The DOS attributes each entry's central directory record carries, by name. */
async function attributes(blob: Blob): Promise<Map<string, { madeBy: number; external: number; flags: number }>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const out = new Map<string, { madeBy: number; external: number; flags: number }>();
  let p = view.getUint32(bytes.length - 6, true);
  while (view.getUint32(p, true) === 0x02014b50) {
    const length = view.getUint16(p + 28, true);
    const name = decode(bytes.subarray(p + 46, p + 46 + length));
    out.set(name, { madeBy: view.getUint16(p + 4, true), external: view.getUint32(p + 38, true), flags: view.getUint16(p + 8, true) });
    p += 46 + length + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

Deno.test("zip: what writeZip writes, readZip and the CRC read back exactly", async () => {
  assertEquals(crc32(encode("123456789")), 0xcbf43926);
  assertEquals(crc32(new Uint8Array()), 0);
  const noise = crypto.getRandomValues(new Uint8Array(60_000));
  const files = [
    { name: "Hero/Player.save", data: encode("[{}]".repeat(5000)), modified: new Date(2026, 9, 1, 12, 34, 56).getTime() },
    { name: "Hero/[ 4,0 ]/Data.tmap", data: new Uint8Array(102_408) },
    { name: "Hero/[ 4,0 ]/noise.png", data: noise },
    { name: "Hero/empty.save", data: new Uint8Array() },
    { name: "Héro/Player.save", data: player },
    { name: "Hero/MirkMap.json", data: encode("{}\n"), hidden: true },
  ];
  const blob = await writeZip(files);
  assertEquals(blob.type, "application/zip");
  const back = await unzip(blob);
  assertEquals([...back.keys()], files.map((f) => f.name));
  for (const f of files) assertEquals([...back.get(f.name)!], [...f.data], f.name);
  // Zeros compress; random bytes are stored rather than grow.
  assert(blob.size < 20_000 + noise.length, `ZIP is ${blob.size} bytes`);
  const attrs = await attributes(blob);
  for (const f of files) {
    const { madeBy, external, flags } = attrs.get(f.name)!;
    assertEquals(madeBy >> 8, 0, "made by MS-DOS, so Windows applies the attributes");
    assertEquals(external, f.hidden ? 0x22 : 0x20, f.name);
    assertEquals(flags & 0x800 ? 1 : 0, f.name.startsWith("Hé") ? 1 : 0, `${f.name} UTF-8 flag`);
  }
  // Local time to 2 seconds, as Windows and the ZIP format keep it.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const local = new DataView(bytes.buffer);
  const time = local.getUint16(10, true), date = local.getUint16(12, true);
  assertEquals([time >> 11, (time >> 5) & 63, (time & 31) * 2], [12, 34, 56]);
  assertEquals([(date >> 9) + 1980, (date >> 5) & 15, date & 31], [2026, 10, 1]);
});

Deno.test("marker: notes are a JSON object; anything else reads as no notes", () => {
  assertEquals(readMarker('\uFEFF{ "fromShare": true, "other": [1] }'), { fromShare: true, other: [1] });
  for (const text of ["", "[MirkMap]\r\nfrom_share=1\r\n", "[1, 2]", "null", '"text"', "{ broken"]) {
    assertEquals(readMarker(text), {}, text);
  }
});

Deno.test("marker: writing sets only the given keys and keeps every other one", () => {
  const fresh = writeMarker(undefined, { fromShare: true, shareDownloaded: "2026-10-11T13:00:00Z" });
  assertEquals(
    fresh,
    '{\n  "about": "MirkMap\'s notes about this world. The game ignores this file.",\n  "fromShare": true,\n' +
      '  "shareDownloaded": "2026-10-11T13:00:00Z"\n}\n',
  );
  assertEquals(writeMarker(fresh, { fromShare: true, shareDownloaded: "2026-10-11T13:00:00Z" }), fresh);

  // A save editor's keys survive, and a key already present changes in place.
  const edited = JSON.stringify({ mine: "keep", cheated: { since: "2026-10-01T00:00:00Z", edits: 3 }, fromShare: false });
  assertEquals(readMarker(writeMarker(edited, { fromShare: true })), {
    mine: "keep",
    cheated: { since: "2026-10-01T00:00:00Z", edits: 3 },
    fromShare: true,
  });
  // Text that is not ours is replaced rather than kept.
  assertEquals(readMarker(writeMarker("[MirkMap]\r\nfrom_share=0\r\n", { fromShare: true })), { fromShare: true });
});

Deno.test("marker: MirkMap.json travels with the game's own files; other JSON and files do not", () => {
  for (const path of ["Player.save", "[ 4,0 ]/Data.tmap", "Maps/0_0.png", "[ 4,0 ]/LastVisit.ini", MARKER, "Hero/mirkmap.JSON"]) {
    assert(isSaveFile(path), path);
  }
  for (const path of ["notes.json", "Hero/NotMirkMap.json", "MirkMap.ini.txt", "readme.txt", "MirkMap.json/x"]) {
    assert(!isSaveFile(path), path);
  }
});
Deno.test("download: folder names stay as the game made them; only names Windows can't use change", () => {
  for (const name of ["Hero", "Sir Lancelot-2_b", "[ 4,0 ]", "Ünïcødé", "a".repeat(100)]) assertEquals(folderName(name), name);
  assertEquals(folderName('a<b>c:d"e/f\\g|h?i*j'), "a_b_c_d_e_f_g_h_i_j");
  assertEquals(folderName("trailing. ."), "trailing");
  assertEquals(folderName("..."), "Character");
  assertEquals(folderName("con"), "_con");
  assertEquals(folderName("LPT1.save"), "_LPT1.save");
  assertEquals(folderName("Conan"), "Conan");
});

function hero(marker?: string): FileMap {
  const files: FileMap = new Map([
    ["Saves/Hero/Player.save", source(player, Date.UTC(2026, 9, 1))],
    ["Saves/Hero/[ 0,0 ]/Containers.save", source(encode("[]"), Date.UTC(2026, 9, 2))],
    ["Saves/Hero/Maps/0_0.png", source(new Uint8Array([137, 80, 78, 71]))],
  ]);
  if (marker !== undefined) files.set(`Saves/Hero/${MARKER}`, source(encode(marker)));
  return files;
}
const shared = async (marker?: string) => unpackSave(await packSave(hero(marker), { name: "Hero", root: "Saves/Hero/" }));

Deno.test("download: a library world comes back as its character folder, byte-for-byte, with no share marker", async () => {
  const { name, files } = await shared();
  const zip = await saveZip(name, files, "Shared/");
  assertEquals([zip.filename, zip.folder], ["Hero.zip", "Hero"]);
  const back = await unzip(zip.blob);
  assertEquals([...back.keys()], ["Hero/Player.save", "Hero/[ 0,0 ]/Containers.save", "Hero/Maps/0_0.png"]);
  for (const [path, bytes] of back) assertEquals([...bytes], [...await hero().get(`Saves/${path}`)!.read()], path);
  assert(!await isFromShare(files, "Shared/"));

  // A marker it already has (here from an earlier share) is kept as it is, and hidden.
  const notes = '{"fromShare":true}';
  const marked = await shared(notes);
  const again = await saveZip(marked.name, marked.files, "Shared/");
  assertEquals(again.filename, "Hero.zip");
  assertEquals(decode((await unzip(again.blob)).get(`Hero/${MARKER}`)!), notes);
  assertEquals((await attributes(again.blob)).get(`Hero/${MARKER}`)!.external, 0x22);
});

Deno.test("download: a world from a share link is marked From Share, keeping other MirkMap.json keys, and MirkMap sees it", async () => {
  const when = new Date(Date.UTC(2026, 9, 11, 13, 47, 18, 463));
  const { name, files } = await shared(JSON.stringify({ cheated: { since: "2026-10-01T00:00:00Z", edits: 1 } }));
  const zip = await saveZip(name, files, "Shared/", when);
  assertEquals([zip.filename, zip.folder], ["Hero (From Share).zip", "Hero"]);
  const back = await unzip(zip.blob);
  assertEquals(readMarker(decode(back.get(`Hero/${MARKER}`)!)), {
    cheated: { since: "2026-10-01T00:00:00Z", edits: 1 },
    fromShare: true,
    shareDownloaded: "2026-10-11T13:47:18Z",
  });
  assertEquals((await attributes(zip.blob)).get(`Hero/${MARKER}`)!.external, 0x22);
  assertEquals((await attributes(zip.blob)).get("Hero/Player.save")!.external, 0x20);
  for (const path of ["Hero/Player.save", "Hero/[ 0,0 ]/Containers.save", "Hero/Maps/0_0.png"]) {
    assertEquals([...back.get(path)!], [...await hero().get(`Saves/${path}`)!.read()], path);
  }

  // Opening the ZIP in MirkMap finds the character under its own name, marked From Share.
  const opened = await fromFiles([new File([zip.blob], zip.filename, { type: "application/zip" })]);
  const characters = findCharacters(opened);
  assertEquals(characters, [{ name: "Hero", root: "Hero/" }]);
  assert((await loadWorld(opened, "Hero/", "Hero")).fromShare);
  assert(!(await loadWorld(hero(), "Saves/Hero/", "Hero")).fromShare);

  // Without a marker, a share download makes one.
  const plain = await shared();
  const made = decode((await unzip((await saveZip(plain.name, plain.files, "Shared/", when)).blob)).get(`Hero/${MARKER}`)!);
  assert(readMarker(made).fromShare === true);
  await assertRejects(() => saveZip("Hero", new Map(), "Shared/"), /no files/);
});

/** Every file in a folder, whatever its type, so nothing the game wrote can be missed. Read-only. */
function readAll(root: string, prefix: string, out = new Map<string, string>()): Map<string, string> {
  for (const entry of Deno.readDirSync(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) readAll(path, `${prefix}${entry.name}/`, out);
    else if (entry.isFile) out.set(`${prefix}${entry.name}`, path);
  }
  return out;
}

Deno.test({
  name: "download: real characters survive upload, the server and download byte-for-byte, as complete folders",
  ignore: !HAVE_SAVES,
}, async () => {
  const directory = await Deno.makeTempDir({ prefix: "mirklurk-download-" });
  const store = new UploadStore(directory);
  await store.init();
  let checked = 0;
  try {
    for (const entry of [...Deno.readDirSync(SAVES)].filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))) {
      const disk = readAll(`${SAVES}/${entry.name}`, `${entry.name}/`);
      if (!disk.has(`${entry.name}/Player.save`)) continue;
      const files: FileMap = new Map();
      for (const [path, real] of disk) {
        files.set(`Saves/${path}`, { read: () => Deno.readFile(real), lastModified: Deno.statSync(real).mtime?.getTime() });
      }
      const character = { name: entry.name, root: `Saves/${entry.name}/` };
      const packed = await packSave(files, character);
      assert(packed.length <= MAX_UPLOAD, `${entry.name} fits the sharing limit`);
      // A fresh library and network per character keeps the per-library and per-network limits out of the way.
      const sync = newToken();
      const id = await worldId(entry.name, parsePlayer(decodeJson(await Deno.readFile(disk.get(`${entry.name}/Player.save`)!))).grid);
      const ip = `198.51.100.${++checked}`;
      const request = (method: string, path: string, body?: Uint8Array) =>
        store.handle(
          new Request(`http://localhost/api${path}`, {
            method,
            headers: { Authorization: `Bearer ${sync}`, ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
            body: body as BodyInit | undefined,
          }),
          ip,
        );
      const put = await request("PUT", `/library/worlds/${id}`, packed);
      assertEquals(put.status, 201, `${entry.name}: ${await put.clone().text()}`);
      assertEquals((await put.json()).fromShare, undefined);
      const data = await request("GET", `/library/worlds/${id}/data`);
      const unpacked = await unpackSave(new Uint8Array(await data.arrayBuffer()));
      const zip = await saveZip(unpacked.name, unpacked.files, "Shared/");
      assertEquals(zip.folder, entry.name);
      const back = await unzip(zip.blob);
      assertEquals([...back.keys()].sort(), [...disk.keys()].sort(), `${entry.name}: the same files`);
      for (const [path, real] of disk) {
        const want = await Deno.readFile(real), got = back.get(path)!;
        assert(want.length === got.length && want.every((b, i) => b === got[i]), `${path} differs`);
      }
    }
    assert(checked > 0, "no characters found");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
