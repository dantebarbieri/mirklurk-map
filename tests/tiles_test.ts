import { assert, assertEquals, assertRejects } from "./assert.ts";
import { areaLayers, ART, mipLevel, tileSource, tileTransform } from "../src/tiles.ts";
import { parseTrees } from "../src/save.ts";

Deno.test("tiles: source rectangles exclude atlas borders and resolve animation", () => {
  assertEquals(tileSource(ART.tilesets.ts_lower, 0), null);
  assertEquals(tileSource(ART.tilesets.ts_lower, 1), [22, 2]);
  assertEquals(tileSource(ART.tilesets.ts_lower, 11 | 0x70000000), [2, 22]);
  for (const set of Object.values(ART.tilesets)) {
    for (let i = 1; i < set.frames.length; i++) {
      const [x, y] = tileSource(set, i)!;
      assert(x >= 0 && y >= 0 && x + 16 <= set.width && y + 16 <= set.height, `${set.file}: ${i}`);
    }
  }
  assertEquals(tileSource(ART.tilesets.ts_wets, 8), [22, 22]);
});

Deno.test("tiles: all eight GameMaker mirror/flip/rotation transforms", () => {
  const expected = [
    [1, 0, 0, 1],
    [-1, 0, 0, 1],
    [1, 0, 0, -1],
    [-1, 0, 0, -1],
    [0, 1, -1, 0],
    [0, -1, -1, 0],
    [0, 1, 1, 0],
    [0, -1, 1, 0],
  ];
  for (let flags = 0; flags < 8; flags++) assertEquals(tileTransform(flags << 28), expected[flags]);
});

Deno.test("tiles: correct room-specific dungeon and roof art", () => {
  const sets = (kind: number) => Object.fromEntries(areaLayers(kind).map((l) => [l.name, l.tileset]));
  assertEquals(sets(10).Dungeon, "ts_cave");
  assertEquals(sets(21).Dungeon, "ts_ruin");
  assertEquals(sets(21).OnTop, "ts_ruin_top");
  assertEquals(sets(26).Dungeon, "ts_riftworld");
  assertEquals(sets(32).EffWater, "ts_castle");
  assertEquals(sets(31).Dungeon, "ts_castle");
  assertEquals(sets(33).OnTop, "ts_ruin_top");
  for (const kind of [0, 1, 10, 20, 24, 30, 31, 32, 33, 34, 35]) {
    const layers = areaLayers(kind);
    assert(layers.every((l, i) => !i || layers[i - 1].depth >= l.depth));
    assert(layers.every((l) => !["Data", "NatureData", "LootData", "EffRain"].includes(l.name)));
  }
});

Deno.test("tiles: filtered mip selection never enlarges a downsampled level", () => {
  assertEquals([8, 1, 0.75, 0.5, 0.25, 0.01].map((s) => mipLevel(s, 6)), [0, 0, 0, 1, 2, 5]);
});

Deno.test("art: every shipped atlas exists with the exported dimensions", async () => {
  for (const asset of [...Object.values(ART.tilesets), ...Object.values(ART.sprites)]) {
    const bytes = await Deno.readFile(new URL(`../${asset.file}`, import.meta.url));
    assertEquals([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(bytes.buffer);
    const width = "columns" in asset ? asset.width : asset.w * asset.frames;
    const height = "columns" in asset ? asset.height : asset.h;
    assertEquals([dv.getUint32(16), dv.getUint32(20)], [width, height], asset.file);
  }
});

Deno.test("trees: preserve saved procedural geometry and reject malformed branches", async () => {
  const part = Array.from({ length: 26 }, (_, i) => i);
  assertEquals(parseTrees([{ index: 4, x: 8, y: 24, partArray: [part] }])[0].parts, [part]);
  await assertRejects(() => parseTrees([{ partArray: [[1, 2]] }]), /branch geometry/);
});
