import { assert, assertEquals } from "./assert.ts";
import {
  axisWeights,
  centeredLattice,
  centerpos,
  coordLabel,
  gridpos,
  isSandTile,
  PLACEMENT,
  reflect,
  shipwreckSiteOk,
  TILES,
} from "../src/rules.ts";

Deno.test("gridpos and centerpos match the GML helpers", () => {
  assertEquals(gridpos(1287), 1280);
  assertEquals(gridpos(-5), 0);
  assertEquals(centerpos(1287), 1288);
  assertEquals(centerpos(568), 568);
});

Deno.test("axis weights count every integer the game can roll", () => {
  const hut = axisWeights(120, 2512);
  assertEquals([...hut.values()].reduce((a, b) => a + b), 2512 - 120 + 1);
  assertEquals(hut.get(112), 8);
  assertEquals(hut.get(128), 16);
  assertEquals(hut.get(2512), 1);
  const ship = PLACEMENT.shipwreck.axis;
  assertEquals([...ship.values()].reduce((a, b) => a + b), 2049);
  assertEquals(ship.get(2304), 1);
});

Deno.test("quest buildings use a 33-step lattice around the zone centre", () => {
  const hideout = centeredLattice(16);
  assertEquals(hideout.size, 33);
  assertEquals(Math.min(...hideout.keys()), 1024);
  assertEquals(Math.max(...hideout.keys()), 1536);
  const lair = centeredLattice(10);
  assertEquals([...lair.values()].reduce((a, b) => a + b), 33);
  assertEquals(Math.min(...lair.keys()), 1120);
  assertEquals(Math.max(...lair.keys()), 1440);
  assert(lair.size < 33, "floors to 16 so several rolls share a tile");
});

Deno.test("shipwreck site test", () => {
  const water = new Uint32Array(TILES * TILES), lower = new Uint32Array(TILES * TILES);
  const at = (x: number, y: number) => y * TILES + x;
  water[at(19, 29)] = 5; // west of the anchor row is water
  lower[at(20, 28)] = 2; // sand above
  assert(isSandTile(lower[at(20, 28)]));
  assert(shipwreckSiteOk(water, lower, 20, 30));
  water[at(28, 29)] = 1; // water 8 tiles east blocks it
  assert(!shipwreckSiteOk(water, lower, 20, 30));
});

Deno.test("labels and reflection", () => {
  assertEquals(coordLabel(2, 1), "C,2");
  assertEquals(reflect(0, 2), [4, 2]);
});
