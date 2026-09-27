import { assert, assertAlmost, assertEquals } from "./assert.ts";
import type { FileMap } from "../src/files.ts";
import { findCharacters } from "../src/files.ts";
import { landmarks, shareOut, zoneHeat } from "../src/predict.ts";
import { loadWorld } from "../src/world.ts";

const enc = new TextEncoder();
const json = (v: unknown) => ({ read: () => Promise.resolve(enc.encode(JSON.stringify(v) + "\0")) });

// Fort at A,1; Scaal's zone is its reflection E,5. Drowned Fens: C,1 D,2. Broken Fens: D,1 D,3.
const GRID = [
  [0, 1, 3, 4, 100],
  [1, 5, 22, 3, 2],
  [100, 2, 23, 4, 1],
  [2, 22, 1, 1, 1],
  [23, 1, 1, 22, 23],
];

function world(player: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const files: FileMap = new Map();
  files.set(
    "Saves/Hero/Player.save",
    json([{
      VERSION: "0.8.1.5",
      worldGrid: GRID,
      worldGridMem: GRID.map((r) => r.map(() => -4)),
      rangerCamp: [1, 0],
      libraryArea: [2, 1],
      riftQuestArea: [4, 4],
      gurbsHut: false,
      shipWreck: false,
      areaX: 0,
      areaY: 0,
      areaType: 0,
      ...player,
    }]),
  );
  for (const [k, v] of Object.entries(extra)) files.set(k, json(v));
  const [c] = findCharacters(files);
  return loadWorld(files, c.root, c.name);
}

Deno.test("shares: pick candidates at random, each entry succeeding with its own chance", () => {
  const s = shareOut([
    { x: 0, y: 0, entry: 0.5, estimated: false, now: false },
    { x: 1, y: 0, entry: 1, estimated: false, now: false },
  ]);
  assertAlmost(s[0].share, 1 / 3);
  assertAlmost(s[1].share, 2 / 3);
  const now = shareOut([
    { x: 0, y: 0, entry: 0.5, estimated: false, now: true },
    { x: 1, y: 0, entry: 1, estimated: false, now: false },
  ]);
  assertAlmost(now[0].share, 0.5 + 0.5 / 3);
  assertAlmost(now[0].share + now[1].share, 1);
});

Deno.test("Gurb-Gurb: every Drowned Fen is equally likely until one is entered", async () => {
  const w = await world({});
  const gurb = landmarks(w, new Map()).find((m) => m.id === "gurb")!;
  assertEquals(gurb.status, "candidates");
  assertEquals(gurb.candidates!.map((c) => [c.x, c.y, c.share]), [[2, 0, 0.5], [3, 1, 0.5]]);
});

Deno.test("Gurb-Gurb: standing in a Drowned Fen means it spawns there on load", async () => {
  const w = await world({ areaX: 3, areaY: 1, areaType: 3 });
  const gurb = landmarks(w, new Map()).find((m) => m.id === "gurb")!;
  assertEquals(gurb.candidates!.find((c) => c.now)?.share, 1);
  assertEquals(gurb.candidates!.find((c) => !c.now)?.share, 0);
});

Deno.test("Ihar: measured shore odds weigh the zones", async () => {
  const w = await world({});
  const ihar = landmarks(w, new Map([["3,0", 0.5]])).find((m) => m.id === "ihar")!;
  const [a, b] = ihar.candidates!;
  assertEquals([a.x, a.y, a.estimated], [3, 0, false]);
  assertEquals([b.x, b.y, b.estimated], [3, 2, true]);
  assertAlmost(a.share, 0.5 / 1.49);
  assertAlmost(b.share, 0.99 / 1.49);
});

Deno.test("created landmarks are found by their building", async () => {
  const w = await world({ gurbsHut: true, worldGridMem: GRID.map((r, y) => r.map((_, x) => (x === 2 && y === 0 ? [3, 12] : -4))) }, {
    "Saves/Hero/[ 2,0 ]/Solids.save": [{
      sprite: "spr_building_80x80",
      index: -2990,
      x: 512,
      y: 976,
      pic: 0,
      zolid: true,
      transPoint: [34, 568, 968, 1192, 1224, -200],
    }],
  });
  const gurb = landmarks(w, new Map()).find((m) => m.id === "gurb")!;
  assertEquals(gurb.status, "found");
  assertEquals(gurb.zone, [2, 0]);
});

Deno.test("created but not found: only explored zones whose folder is missing can hide it", async () => {
  const mem = GRID.map((r, y) => r.map((_, x) => ((x === 2 && y === 0) || (x === 3 && y === 1) ? [3, 12] : -4)));
  const w = await world({ gurbsHut: true, worldGridMem: mem }, { "Saves/Hero/[ 2,0 ]/Solids.save": [] });
  const gurb = landmarks(w, new Map()).find((m) => m.id === "gurb")!;
  assertEquals(gurb.candidates!.map((c) => [c.x, c.y, c.share]), [[3, 1, 1]]);
});

Deno.test("hut heat on a loaded zone needs something to touch; nearby trees count", async () => {
  const w = await world({ areaX: 3, areaY: 1, areaType: 3, xx: 1208, yy: 1208 }, { "Saves/Hero/[ 3,1 ]/Solids.save": [] });
  const marks = landmarks(w, new Map());
  const count = (trees: { index: number; x: number; y: number }[]) => {
    const [h] = zoneHeat(w, marks, w.zones[1][3], { trees });
    return h.heat.filter((v) => v > 0).length;
  };
  const alone = count([]);
  // The player (spr_human_legs box 1201..1214 × 1203..1213) is the only thing to touch: 7 × 10 anchors.
  assertEquals(alone, 70);
  assert(count([{ index: 4, x: 1400, y: 1300 }]) > alone, "a tree in view adds spots");
  assertEquals(count([{ index: 4, x: 200, y: 200 }]), alone, "a tree far off-screen is inactive");
});

Deno.test("unexplored quest zones get the exact lattice heat", async () => {
  const w = await world({});
  const marks = landmarks(w, new Map());
  const lib = marks.find((m) => m.id === "library")!;
  assertEquals([lib.status, lib.zone], ["zone", [2, 1]]);
  const [heat] = zoneHeat(w, marks, w.zones[1][2]);
  assertEquals(heat.id, "library");
  let sum = 0, cells = 0;
  for (const v of heat.heat) if (v > 0) sum += v, cells++;
  assertAlmost(sum, 1, 1e-5);
  assertEquals(cells, 33 * 33);
  const bhato = zoneHeat(w, marks, w.zones[0][1]).find((h) => h.id === "bhato")!;
  assert(bhato, "Bhato's zone B,1 has a heat map");
});
