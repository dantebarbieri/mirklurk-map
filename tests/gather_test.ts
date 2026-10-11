import { assert, assertEquals } from "./assert.ts";
import {
  amountRange,
  fernAt,
  fernShade,
  GATHER_KINDS,
  GATHER_LAYERS,
  gatherAt,
  gatherDetail,
  gatherMarks,
  gatherOrder,
} from "../src/gather.ts";
import { ITEM_NAMES } from "../src/gamedata.ts";
import { LAYERS } from "../src/objects.ts";
import { TILES } from "../src/rules.ts";
import { entityWiki, itemImage, wikiUrl } from "../src/wiki.ts";

/** Every count loot_amountchances(a, b) can return: i in 0…b−1, then irandom_range(a, a+i). */
function amountChances(a: number, b: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i < b; i++) for (let v = a; v <= a + i; v++) out.add(v);
  return [...out].sort((x, y) => x - y);
}

Deno.test("gather: amount ranges follow loot_amountchances", () => {
  for (const [a, b] of [[1, 3], [1, 2], [1, 7], [2, 4], [3, 6], [4, 8], [1, 2], [5, 8]]) {
    const all = amountChances(a, b);
    assertEquals(amountRange(a, b), [all[0], all[all.length - 1]], `loot_amountchances(${a}, ${b})`);
  }
});

Deno.test("gather: Hinderance tiles and what they give", () => {
  assertEquals(gatherAt(147), { kind: "calmia", item: 142, amount: [1, 3] });
  assertEquals(gatherAt(148), { kind: "bulb", item: 173, amount: [1, 2] });
  // Turnips: two looks of five stages; stages 4 and 5 give two (loot_generate case 1067).
  assertEquals([150, 151, 152, 153, 154].map((t) => gatherAt(t)!.amount), [[1, 1], [1, 1], [1, 1], [2, 2], [2, 2]]);
  assertEquals([155, 156, 157, 158, 159].map((t) => gatherAt(t)!.amount), [[1, 1], [1, 1], [1, 1], [2, 2], [2, 2]]);
  assertEquals(gatherAt(158)?.stage, 3);
  // Cranberries: no berries before 162, then (n, 2n) with n = 2, 3, 4 (case 1068).
  assertEquals([160, 161, 162, 163, 164].map((t) => gatherAt(t)!.amount), [null, null, [2, 5], [3, 8], [4, 11]]);
  // Watercress: (n, round(1.5n)) with n = stage + 1, GameMaker rounding halves to even (case 1069).
  const cress: [number, number][] = [[1, 2], [2, 4], [3, 6], [4, 9], [5, 12]];
  assertEquals([170, 171, 172, 173, 174].map((t) => gatherAt(t)!.amount), cress);
  assertEquals([175, 176, 177, 178, 179].map((t) => gatherAt(t)!.amount), cress);
  // Only flowering lilypads give Water Lilies (case 1065).
  assertEquals([73, 74, 78, 79].map((t) => gatherAt(t)!.amount), [[1, 1], [2, 2], [1, 1], [2, 2]]);
  assertEquals(gatherAt(146), { kind: "nest", item: 77, amount: [1, 7] });
  assertEquals(gatherAt(145), { kind: "nest", item: 77, amount: null });
  // Bare ground, boulders, logs, ferns (Plant Fiber, everywhere), young lilypads, searchable rocks and planted seeds.
  for (const t of [0, 5, 25, 70, 71, 72, 75, 76, 77, 80, 89, 125, 140, 144, 149, 165, 169, 180]) {
    assertEquals(gatherAt(t), null, `tile ${t}`);
  }
});

Deno.test("gather: details name the yield, unripe and refilling states and leftovers", () => {
  assertEquals(gatherDetail(gatherAt(163)!), "Cranberries x3–8 (grown)");
  assertEquals(gatherDetail(gatherAt(160)!), "no berries yet (sprouting)");
  assertEquals(gatherDetail(gatherAt(154)!), "Turnip x2 (full grown)");
  assertEquals(gatherDetail(gatherAt(147)!), "Calmia Root x1–3");
  assertEquals(gatherDetail(gatherAt(146)!, 56), "Feather x1–7, 40% chance of Egg x1–3");
  assertEquals(gatherDetail(gatherAt(145)!, 1), "searched; refills in about 1 day");
  assertEquals(gatherDetail(gatherAt(145)!, 7), "searched; refills in about 7 days");
  assertEquals(gatherDetail(gatherAt(146)!, 99), "searched; what was left lies in its ground loot");
  assertEquals(gatherDetail(gatherAt(74)!, 99), "harvested; what was left lies in its ground loot");
});

Deno.test("gather: one mark per tile at its centre, with mirrored tiles and LootData", () => {
  const grid = (cells: [number, number, number][]) => {
    const data = new Uint32Array(TILES * TILES);
    for (const [x, y, v] of cells) data[y * TILES + x] = v;
    return { w: TILES, h: TILES, data };
  };
  const mirrored = 0x10000000;
  const hinderance = grid([[0, 0, 147], [10, 3, 162 | mirrored], [11, 3, 160], [5, 159, 145], [6, 159, 146], [100, 100, 80], [20, 20, 74]]);
  const loot = grid([[5, 159, 7], [20, 20, 99]]);
  const marks = gatherMarks(hinderance, loot);
  assertEquals(
    marks.map((m) => [m.layer, m.kind, m.x, m.y]),
    [
      ["calmia", "gather calmia", 8, 8],
      ["cranberries", "gather cranberry", 168, 56],
      ["cranberries", "gather cranberry unripe", 184, 56],
      ["lilies", "gather lily", 328, 328],
      ["nests", "gather nest empty", 88, 2552],
      ["nests", "gather nest", 104, 2552],
    ],
  );
  assertEquals(marks[4].detail, "searched; refills in about 7 days");
  assertEquals(marks[3].detail, "harvested; what was left lies in its ground loot");
  assertEquals(marks.map((m) => m.item), [142, 225, 225, 175, 77, 77]);
  // Without LootData every gatherable still shows.
  assertEquals(gatherMarks(hinderance).length, 6);
  assertEquals(
    [...marks].sort(gatherOrder).map((m) => m.kind),
    ["gather nest", "gather cranberry", "gather calmia", "gather lily", "gather cranberry unripe", "gather nest empty"],
  );
});

Deno.test("gather: ferns are shaded by growth stage, not marked", () => {
  // Plant Fiber (n, 2n) with n = stage + 1, in two looks of five stages (loot_generate case 57).
  const fiber: [number, number][] = [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]].map(([a, b]) => amountRange(a, b));
  assertEquals(fiber, [[1, 2], [2, 5], [3, 8], [4, 11], [5, 14]]);
  assertEquals([80, 81, 82, 83, 84].map((t) => fernAt(t)!.amount), fiber);
  assertEquals([85, 86, 87, 88, 89].map((t) => fernAt(t)!.amount), fiber);
  assertEquals([79, 90, 0, 147].map(fernAt), [null, null, null, null]);
  assertEquals([80, 84, 85, 89].map((t) => fernShade(t)![3]), [80, 200, 80, 200]);
  assertEquals(fernShade(73), null);
  for (let t = 80; t < 90; t++) assertEquals(gatherAt(t), null, `fern ${t} has no marker`);
});

Deno.test("gather: every kind has its own layer, wiki page and yield picture", () => {
  const ids = new Set(LAYERS.map((l) => l.id));
  for (const layer of GATHER_LAYERS) assert(ids.has(layer), `${layer} is a map layer`);
  assertEquals(GATHER_LAYERS.size, Object.keys(GATHER_KINDS).length);
  for (const k of Object.values(GATHER_KINDS)) {
    const url = entityWiki(k.name, "Plant harvesting");
    assert(url && url !== wikiUrl("Plant harvesting"), `${k.name} has its own wiki page`);
  }
  for (const t of [147, 148, 150, 162, 170, 73, 146]) {
    const item = gatherAt(t)!.item;
    assert(ITEM_NAMES[item] && itemImage(item), `item ${item} has a name and a picture`);
  }
});
