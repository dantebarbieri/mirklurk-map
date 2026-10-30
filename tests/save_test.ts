import { assert, assertEquals, assertRejects, assertThrows } from "./assert.ts";
import {
  decodeJson,
  decodeTilemap,
  destination,
  parseAreaDir,
  parseBeings,
  parsePlaced,
  parsePlayer,
  parseSolids,
  parseTrees,
  type Solid,
} from "../src/save.ts";
import { readZip } from "../src/zip.ts";
import { loadDetail, loadWorld } from "../src/world.ts";

const enc = new TextEncoder();

Deno.test("a save without a player record is refused before anything is read from it", () => {
  for (const raw of [[], [[1]], [{}, 3], "x"]) assertThrows(() => parsePlayer(raw), /no player record/);
});

Deno.test("a solid leads somewhere only when its transPoint has an area type and a position", () => {
  const solid = (transPoint: number[] | null): Solid => ({ sprite: "", pic: 0, index: 0, x: 0, y: 0, transPoint });
  assertEquals(destination(solid([10, 1000, 1000, 1280, 1400])), [10, 1000, 1000, 1280, 1400]);
  assertEquals([destination(solid(null)), destination(solid([10, 1000]))], [null, null]);
});

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
  assertThrows(() => decodeTilemap(bytes.subarray(0, 100)), /unexpected grid size/);
});

Deno.test("area parsers reject malformed records instead of creating default objects", () => {
  for (const parse of [parseSolids, parseBeings, parsePlaced, parseTrees]) {
    assertEquals(parse(undefined), []);
    assertEquals(parse([]), []);
    for (const invalid of [null, {}, "records", [null], [[]], [-4], [{}, false]]) {
      assertThrows(() => parse(invalid), /Invalid saved record list/);
    }
  }
});

Deno.test("malformed area lists surface warnings while absent optional files stay empty", async () => {
  const source = (raw: unknown) => ({ read: () => Promise.resolve(enc.encode(JSON.stringify(raw))) });
  const world = await loadWorld(
    new Map([
      ["Player.save", source([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]) }])],
      ["[ 0,0 ]/Solids.save", source("not a list")],
      ["[ 0,0 ]/Beings.save", source([false])],
      ["[ 0,0 ]/Containers.save", source([null])],
    ]),
    "",
    "Hero",
  );
  const detail = await loadDetail(world, "[ 0,0 ]/");
  assertEquals(world.zones[0][0].solids, []);
  assertEquals(detail.beings, []);
  assertEquals(detail.containers, []);
  assertEquals(detail.stations, []);
  assertEquals(world.warnings.length, 3);
  for (const file of ["Solids.save", "Beings.save", "Containers.save"]) {
    assert(world.warnings.some((warning) => warning.includes(file) && warning.includes("Invalid saved record list")));
  }
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
  // Saves before 0.8.9.9 have no camp or campQ: the game reads them as false and −1 (load_player).
  assertEquals([p.camp, p.campQuest], [false, -1]);
  const robin = parsePlayer([{ worldGrid: grid, camp: true, campQ: 2 }]);
  assertEquals([robin.camp, robin.campQuest], [true, 2]);
});

Deno.test("placed objects keep a flip (xscale) only when it mirrors them", () => {
  const at = { sprite: "spr_placed_16x16", pic: 0, index: 38, status: -200, x: 8, y: 8 };
  assertEquals(parsePlaced([{ ...at, xscale: -1 }, { ...at, xscale: 1 }, at]).map((p) => p.xscale), [-1, undefined, undefined]);
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
Deno.test("player: shield rank is optional and reads Fighter skill 4, not unspent points", () => {
  const worldGrid = Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]);
  assertEquals(parsePlayer([{ worldGrid }]).shieldSavant, undefined);
  assertEquals(parsePlayer([{ worldGrid, skillPoints: 99, fighterSkills: [1, 2, 3, 4, 7] }]).shieldSavant, 7);
  for (const fighterSkills of [[], [0, 0, 0, 0, "7"], [0, 0, 0, 0, NaN]]) {
    assertEquals(parsePlayer([{ worldGrid, fighterSkills }]).shieldSavant, undefined);
  }
});
