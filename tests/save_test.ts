import { assert, assertEquals, assertRejects } from "./assert.ts";
import { decodeJson, decodeTilemap, parseAreaDir, parsePlayer } from "../src/save.ts";
import { readZip } from "../src/zip.ts";

const enc = new TextEncoder();

Deno.test("GameMaker JSON: one trailing NUL, optional BOM, empty file", () => {
  assertEquals(decodeJson(enc.encode('[{"a":1}]\0')), [{ a: 1 }]);
  assertEquals(decodeJson(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("[2]")])), [2]);
  assertEquals(decodeJson(new Uint8Array([0])), []);
});

Deno.test("area folder names", () => {
  assertEquals(parseAreaDir("[ 2,1 ]"), [2, 1]);
  assertEquals(parseAreaDir("[ 2,1,568,968 ]"), [2, 1, 568, 968]);
  assertEquals(parseAreaDir("Maps"), null);
});

Deno.test("tilemaps must be 160×160", () => {
  const bytes = new Uint8Array(8 + 160 * 160 * 4);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 160, true);
  dv.setUint32(4, 160, true);
  dv.setUint32(8 + 4 * 161, 0x80005, true);
  const g = decodeTilemap(bytes);
  assertEquals(g.data[161] & 0x7ffff, 5);
  let threw = false;
  try {
    decodeTilemap(bytes.subarray(0, 100));
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("player record is read row-major", () => {
  const grid = [[0, 1, 2, 3, 4], [5, 22, 23, 100, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]];
  const p = parsePlayer([{
    worldGrid: grid,
    worldGridMem: [[[3, 16.5], -4, -4, -4, -4]],
    rangerCamp: [1, 0],
    gurbsHut: true,
    areaX: 0,
    areaY: 0,
  }]);
  assertEquals(p.grid[1][2], 23);
  assertEquals(p.lastVisit[0][0], [3, 16.5]);
  assertEquals(p.lastVisit[0][1], null);
  assertEquals(p.rangerCamp, [1, 0]);
  assertEquals(p.gurbsHut, true);
  assertEquals(p.shipWreck, false);
});

async function makeZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate
      ? new Uint8Array(
        await new Response(new Blob([f.data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer(),
      )
      : f.data;
    const name = enc.encode(f.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...parts, ...central, end] as BlobPart[]).arrayBuffer());
}

Deno.test("zip: stored and deflated entries", async () => {
  const text = enc.encode("[1,2,3]\0".repeat(50));
  const zip = await makeZip([
    { name: "Hero/Player.save", data: text, deflate: true },
    { name: "Hero/[ 0,2 ]/Solids.save", data: enc.encode("[]\0"), deflate: false },
  ]);
  const entries = await readZip(new Blob([zip as BlobPart]));
  assertEquals(entries.map((e) => e.name), ["Hero/Player.save", "Hero/[ 0,2 ]/Solids.save"]);
  assertEquals(new TextDecoder().decode(await entries[0].read()), new TextDecoder().decode(text));
  assertEquals(decodeJson(await entries[1].read()), []);
  await assertRejects(() => readZip(new Blob([enc.encode("not a zip")])), /not a ZIP/);
});
