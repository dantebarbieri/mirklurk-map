// The save editor's pure edits: player stats, time and weather, moving, adding items, creatures, ground checks and the Cheated
// mark. Real saves are edited in memory (never written) when available (skipped otherwise):
//   MIRKLURK_SAVES="…\Saves" deno task test

import { assert, assertEquals } from "./assert.ts";
import {
  healPlayer,
  movePlayer,
  playerRecord,
  type Rec,
  setLevel,
  setNewHitPoints,
  setSkillPoints,
  setSky,
  setVitals,
} from "../src/editor/edits.ts";
import {
  addable,
  addItems,
  carriedBags,
  carriedItems,
  countInside,
  fitsSlot,
  freeCells,
  freeSlots,
  freeSlotsFor,
  isTwoHandedMelee,
  itemAt,
  newItem,
  removeItem,
  SLOT_TAKES,
  takeOff,
  wearCarried,
  wearNew,
} from "../src/editor/items.ts";
import { deleteBeing, isQuestBeing, newBeing, spawnable, spawnBeing } from "../src/editor/beings.ts";
import { Ground, groundMap, tileBox } from "../src/editor/ground.ts";
import { cheatedInfo, ensureCheated, isCheated, markCheated } from "../src/cheated.ts";
import { readMarker, writeMarker } from "../src/marker.ts";
import { decodeJson, parseBeings, parsePlayer } from "../src/save.ts";
import { parseInventoryGrid } from "../src/inventory.ts";
import { xpForLevel } from "../src/player.ts";
import { TILES } from "../src/rules.ts";
import { Weather } from "../src/weather.ts";
import { ITEMS } from "../src/itemdata.ts";
import { freshHealth } from "../src/bestiary.ts";
import { countCoins } from "../src/coins.ts";
import type { FileMap } from "../src/files.ts";

const E = -4;
function assertThrows(fn: () => unknown, match: RegExp) {
  try {
    fn();
  } catch (e) {
    if (!match.test((e as Error).message)) throw new Error(`wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected an error matching ${match}`);
}
const cell = (index: number, amount: number, X: number, Y: number, extra: Rec = {}): Rec => ({
  index,
  amount,
  X,
  Y,
  durability: 1,
  wet: 0,
  rotation: 0,
  sideflipped: false,
  neww: false,
  subParts: [],
  ...extra,
});
/** A pouch (item 13, a 4×2 inventory) carrying what `grid` says, in equipment slot 2 of 4. */
function player(grid: unknown[][], over: Rec = {}): Rec {
  return {
    level: 3,
    xp: 10,
    skillPoints: 1,
    hpAddPoints: 0,
    areaX: 2,
    areaY: 1,
    areaType: 1,
    xx: 40,
    yy: 40,
    worldGrid: [[0, 1, 2, 3, 4], [1, 1, 1, 30, 5], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 22]],
    myEquips: [E, cell(13, 1, 0, 0, { subParts: [{ type: 0, parentIndex: 13, X: 33, Y: 900, grabY: 24, gridSave: grid }] }), E, E],
    ...over,
  };
}
const empty = (w: number, h: number) => Array.from({ length: h }, () => Array<unknown>(w).fill(E));

Deno.test("level changes grant or take back skill points, and hit points every third level, and keep XP under the threshold", () => {
  const p = player([[E]], { level: 3, xp: 50, skillPoints: 1, hpAddPoints: 0 });
  setLevel(p, 6);
  assertEquals([p.level, p.skillPoints, p.hpAddPoints], [6, 4, 1], "levels 4, 5 and 6: three skill points, one hit point at 6");
  assert(Number(p.xp) <= xpForLevel(6) - 1);
  setLevel(p, 8);
  assertEquals([p.skillPoints, p.hpAddPoints], [6, 1], "no hit point for levels 7 and 8");
  setLevel(p, 9);
  assertEquals(p.hpAddPoints, 2);
  setLevel(p, 1);
  assertEquals([p.level, p.skillPoints, p.hpAddPoints], [1, 0, 0], "never below zero");
  assertEquals(p.xp, xpForLevel(1) - 1, "XP clamped under level 1's threshold");
  assertThrows(() => setLevel(p, 0), /Level/);
  assertThrows(() => setLevel(p, 2.5), /Level/);
});

Deno.test("skill and new hit points are whole and not negative", () => {
  const p = player([[E]]);
  setSkillPoints(p, 12);
  setNewHitPoints(p, 3);
  assertEquals([p.skillPoints, p.hpAddPoints], [12, 3]);
  assertThrows(() => setSkillPoints(p, -1), /Skill points/);
  assertThrows(() => setNewHitPoints(p, 1.5), /New hit points/);
});

Deno.test("vitals set both the value and its target; wellbeing sets every wellbeing cell", () => {
  const p: Rec = {
    hunger: 0.1,
    hungerNext: 0.2,
    energy: 0.5,
    energyNext: 0.5,
    haelth: 0.3,
    nextHaelth: 0.3,
    wbgrid: [[E, { haelth: 0.1, myP: 1 }], [{ haelth: 0.9, myP: 2 }, E]],
  };
  setVitals(p, { satiation: 0.8, stamina: 1.4, wellbeing: 0.75 });
  assertEquals([p.hunger, p.hungerNext, p.energy, p.energyNext], [0.8, 0.8, 1, 1]);
  assertEquals([p.haelth, p.nextHaelth], [0.75, 0.75]);
  assertEquals(p.wbgrid, [[E, { haelth: 0.75, myP: 1 }], [{ haelth: 0.75, myP: 2 }, E]]);
  assert(!("focus" in p), "untouched vitals stay absent");
});

Deno.test("healing restores lost and burned hit points, keeps armor and holes, and clears statuses", () => {
  const p: Rec = { hpgrid: [[1, 0, -1], [E, 3, 0]], statusgrid: [[[2], [], [10, 11]], [[], [23], []]] };
  assertEquals(healPlayer(p), 3);
  assertEquals(p.hpgrid, [[1, 1, 1], [E, 3, 1]]);
  assertEquals(p.statusgrid, [[[], [], []], [[], [], []]]);
});

Deno.test("weather is written as the game leaves each state; the day moves daysAlive with it", () => {
  const p: Rec = { MDday: 5, daysAlive: 4, MDminute: 100, MDweather: 0, MDcloud: 0, MDrain: 0 };
  setSky(p, { weather: Weather.Rain, rain: 0.01 });
  assertEquals([p.MDweather, p.MDcloud, p.MDrain], [2, 1, 0.08], "rain at least 0.08");
  setSky(p, { rain: 0.6 });
  assertEquals(p.MDrain, 0.6);
  setSky(p, { weather: Weather.Cloudy });
  assertEquals([p.MDweather, p.MDcloud, p.MDrain], [1, 1, 0]);
  setSky(p, { rain: 0.9 });
  assertEquals(p.MDrain, 0, "rain needs Rain");
  setSky(p, { weather: Weather.Clear, day: 9, minute: 1439, temperature: 2 });
  assertEquals([p.MDweather, p.MDcloud, p.MDrain, p.MDday, p.daysAlive, p.MDminute, p.MDtemperature], [0, 0, 0, 9, 8, 1439, 1]);
  setSky(p, { day: 1 });
  assertEquals([p.MDday, p.daysAlive], [1, 0]);
  assertThrows(() => setSky(p, { minute: 1440 }), /Minute/);
  assertThrows(() => setSky(p, { day: 0 }), /Day/);
});

Deno.test("moving the player stands them on a tile centre of an outdoor zone", () => {
  const p = player([[E]], { areaType: 30, entranceX: 440, entranceY: 2120 });
  movePlayer(p, 4, 0, 10, 159);
  assertEquals([p.areaX, p.areaY, p.areaType, p.xx, p.yy], [4, 0, 4, 168, 2552]);
  assertEquals([p.entranceX, p.entranceY], [440, 2120], "entrance kept");
  assertThrows(() => movePlayer(p, 3, 1, 1, 1), /outdoor/);
  assertThrows(() => movePlayer(p, 0, 0, TILES, 1), /Tile/);
});

Deno.test("new items are made as the item constructor makes them", () => {
  const coin = newItem(72, 5, [1, 2]);
  assertEquals(coin, {
    index: 72,
    amount: 5,
    X: E,
    Y: E,
    durability: 100,
    wet: 0,
    rotation: 0,
    sideflipped: false,
    neww: true,
    subParts: [],
  });
  const torch = newItem(41, 1, [0, 0]);
  assertEquals([torch.burnTimeLeft, torch.lit], [ITEMS[41].burn, false]);
  assertEquals(newItem(89, 1, [3, 4]).connectedArea, [3, 4]);
  assertEquals((newItem(252, 1, [0, 0]).collectedAreas as number[][]).flat().length, 25);
  const bag = newItem(196, 1, [0, 0], { X: 33, Y: 900, grabY: 24 });
  const inv = (bag.subParts as Rec[])[0];
  assertEquals([inv.type, inv.parentIndex, inv.X, inv.Y, inv.WIDTH, inv.HEIGHT], [0, 196, 33, 900, 48, 48]);
  assertEquals(inv.gridSave, empty(3, 3));
  assert(!addable(31), "fists are not items");
});

Deno.test("adding tops up stacks first, then fills free space column by column", () => {
  const grid = empty(4, 2);
  grid[0][0] = cell(72, 18, 0, 0, { wet: 0.5 });
  const p = player(grid);
  const r = addItems(p, 72, 25);
  assertEquals(r, { added: 25, left: 0 });
  const g = carriedBags(p)[0].grid as Rec[][];
  assertEquals([g[0][0].amount, g[0][0].wet], [20, 0.45], "topped up to the stack limit, wetness averaged");
  assertEquals([g[1][0].X, g[1][0].Y, g[1][0].amount, g[1][0].neww], [0, 1, 20, true], "next stack goes down the first column");
  assertEquals([g[0][1].X, g[0][1].Y, g[0][1].amount], [1, 0, 3]);
});

Deno.test("larger items fill every cell they cover with a copy carrying their origin", () => {
  const p = player(empty(4, 2));
  // Item 13 is 2×1.
  assertEquals(addItems(p, 13, 5), { added: 4, left: 1 });
  const g = carriedBags(p)[0].grid as Rec[][];
  assertEquals(g.map((row) => row.map((c) => `${c.X},${c.Y}`)), [["0,0", "0,0", "2,0", "2,0"], ["0,1", "0,1", "2,1", "2,1"]]);
  assert(g[0][0] !== g[0][1], "each cell has its own copy, as a parsed save does");
  const parsed = parseInventoryGrid(g);
  assert(parsed.state === "saved" && parsed.items.length === 4 && !parsed.note, "the viewer reads them back cleanly");
  assertEquals(freeCells(p), 0);
});

Deno.test("adding reports what does not fit and refuses nonsense", () => {
  const p = player(empty(1, 1));
  assertEquals(addItems(p, 8, 1), { added: 0, left: 1 }, "a 1×4 spear does not fit a 1×1 grid");
  assertThrows(() => addItems(p, 72, 0), /Amount/);
  assertThrows(() => addItems(p, 9999, 1), /cannot be carried/);
  const none = player(empty(1, 1), { myEquips: [E, E] });
  assertEquals(addItems(none, 72, 3), { added: 0, left: 3 }, "no containers carried");
});

Deno.test("carried items are listed by slot and container, nested containers included", () => {
  const grid = empty(4, 2);
  grid[0][0] = cell(72, 18, 0, 0);
  const inner = empty(4, 2);
  inner[0][0] = cell(72, 5, 0, 0);
  // A pouch (2×1) inside the pouch: each of its two cells holds a full copy, contents included.
  const pouch = cell(13, 1, 2, 0, { subParts: [{ type: 0, parentIndex: 13, gridSave: inner }] });
  grid[0][2] = pouch;
  grid[0][3] = JSON.parse(JSON.stringify(pouch));
  const p = player(grid);
  const list = carriedItems(p);
  assertEquals(list.length, 1, "one worn item: the pouch in slot 2");
  const [worn] = list;
  assertEquals([worn.place, worn.index], [{ slot: 1, path: [] }, 13]);
  assertEquals(worn.contents.map((c) => [c.index, c.amount, c.place.path]), [
    [72, 18, [{ part: 0, x: 0, y: 0 }]],
    [13, 1, [{ part: 0, x: 2, y: 0 }]],
  ]);
  assertEquals(worn.contents[1].contents.map((c) => [c.index, c.amount]), [[72, 5]]);
  assertEquals(countInside(worn), 3);
  assertEquals(itemAt(p, worn.contents[1].contents[0].place)?.amount, 5);
});

Deno.test("removing items empties every cell they cover and keeps every copy of their containers the same", () => {
  const grid = empty(4, 2);
  grid[0][0] = cell(72, 18, 0, 0);
  const inner = empty(4, 2);
  inner[0][0] = cell(72, 5, 0, 0);
  const pouch = cell(13, 1, 2, 0, { subParts: [{ type: 0, parentIndex: 13, gridSave: inner }] });
  grid[0][2] = pouch;
  grid[0][3] = JSON.parse(JSON.stringify(pouch));
  const p = player(grid);
  const g = carriedBags(p)[0].grid as Rec[][];
  const stack = { slot: 1, path: [{ part: 0, x: 0, y: 0 }] };
  const nested = { slot: 1, path: [{ part: 0, x: 2, y: 0 }, { part: 0, x: 0, y: 0 }] };

  assertEquals(removeItem(p, stack, 72, 3), { removed: 3, inside: 0 });
  assertEquals(g[0][0].amount, 15, "part of a stack");
  assertEquals(removeItem(p, nested, 72, 2), { removed: 2, inside: 0 });
  const innerOf = (c: Rec) => ((c.subParts as Rec[])[0].gridSave as Rec[][])[0][0].amount;
  assertEquals([innerOf(g[0][2]), innerOf(g[0][3])], [3, 3], "both cells of the inner pouch hold the same contents");
  assertThrows(() => removeItem(p, nested, 72, 4), /only 3/);
  assertThrows(() => removeItem(p, stack, 13, 1), /no longer there/);
  assertThrows(() => removeItem(p, stack, 72, 0), /Amount/);

  assertEquals(removeItem(p, { slot: 1, path: [{ part: 0, x: 2, y: 0 }] }, 13, "all"), { removed: 1, inside: 1 });
  assertEquals([g[0][2], g[0][3]], [E, E], "every cell the inner pouch covered is empty");
  assertEquals(removeItem(p, stack, 72, "all"), { removed: 15, inside: 0 });
  assertEquals(freeCells(p), 8);
  const parsed = parseInventoryGrid(g);
  assert(parsed.state === "saved" && !parsed.items.length && !parsed.note, "the viewer reads an empty pouch");
  assertThrows(() => removeItem(p, stack, 72, "all"), /no longer there/);
});

Deno.test("removing a worn item empties its slot, and a two-handed weapon's off-hand copy with it", () => {
  const spear = cell(8, 1, E, E);
  const helmet = cell(40, 1, E, E);
  const p = player(empty(1, 1), {
    myEquips: [spear, JSON.parse(JSON.stringify(spear)), E, cell(30, 12, E, E), helmet],
    actives: [true, true, false, false],
  });
  assertEquals(carriedItems(p).map((c) => [c.place.slot, c.index]), [[0, 8], [3, 30], [4, 40]], "the off-hand copy is not listed");
  assertEquals(removeItem(p, { slot: 3, path: [] }, 30, 2), { removed: 2, inside: 0 });
  assertEquals((p.myEquips as Rec[])[3].amount, 10);
  removeItem(p, { slot: 0, path: [] }, 8, "all");
  removeItem(p, { slot: 4, path: [] }, 40, "all");
  assertEquals((p.myEquips as unknown[]).map((e) => e === E ? E : (e as Rec).index), [E, E, E, 30, E]);
  assertEquals(parsePlayer([p]).equipment.map((e) => e.slot), [3], "the viewer reads the slots back");
});

Deno.test("equipment: items fit the slots the game lets them into", () => {
  assertEquals(SLOT_TAKES.length, 16);
  const slots = (index: number) => SLOT_TAKES.flatMap((_, s) => fitsSlot(index, s) ? [s] : []);
  assertEquals(slots(12), [8], "a backpack goes on the back");
  assertEquals(slots(13), [9], "a pouch on the belt");
  assertEquals(slots(8), [0, 2], "a one-handed weapon in either main hand");
  assertEquals(slots(29), [0, 2], "a two-handed weapon in a main hand");
  assertEquals(slots(45), [1, 3], "ammunition in an off hand");
  assertEquals(slots(0), [1, 3]);
  assertEquals(slots(41), [0, 1, 2, 3], "type 23 in any hand");
  assertEquals(slots(72), [], "coins are not worn");
  assert(isTwoHandedMelee(29) && !isTwoHandedMelee(44) && !isTwoHandedMelee(8), "bows leave the off hand to arrows");
});

/** A character with 16 equipment slots, as Player.save has them; `worn` fills some. */
const dressed = (worn: Record<number, Rec>) => {
  const equips: unknown[] = Array(16).fill(E);
  for (const [slot, item] of Object.entries(worn)) equips[Number(slot)] = item;
  return player(empty(1, 1), { myEquips: equips, actives: Array(16).fill(true) });
};
const backpack = (grid = empty(7, 5)) => cell(12, 1, E, E, { subParts: [{ type: 0, parentIndex: 12, gridSave: grid }] });

Deno.test("equipment: a character with nothing to carry things in puts on a new backpack, then carries items in it", () => {
  const p = dressed({ 6: cell(22, 1, E, E) });
  assertEquals(addItems(p, 72, 5), { added: 0, left: 5 }, "nowhere to put coins");
  assertEquals(freeSlots(p).length, 15);
  assertEquals(wearNew(p, 12), { slot: 8, amount: 1 });
  const pack = (p.myEquips as Rec[])[8];
  assertEquals([pack.index, pack.X, pack.Y, pack.neww, pack.amount], [12, E, E, true, 1]);
  assertEquals(freeCells(p), 35, "an empty 7×5 backpack");
  assertEquals(addItems(p, 72, 5), { added: 5, left: 0 });
  assertThrows(() => wearNew(p, 26), /no free slot/);
  assertThrows(() => wearNew(p, 72), /cannot be worn/);
  assertThrows(() => wearNew(p, 12, 1, 9), /no free slot/);
  assertEquals(wearNew(p, 45, 50), { slot: 1, amount: ITEMS[45].stack }, "a stack up to its limit");
  assertEquals(parsePlayer([p]).equipment.map((e) => [e.slot, e.item.index]), [[1, 45], [6, 22], [8, 12]], "the viewer reads it back");
});

Deno.test("equipment: a two-handed weapon fills the off hand, comes off into a bag and goes back on", () => {
  const p = dressed({ 1: cell(45, 10, E, E), 8: backpack() });
  const equips = p.myEquips as unknown[];
  assertEquals(freeSlotsFor(p, 29), [2], "the first set's off hand holds arrows");
  assertEquals(freeSlotsFor(p, 44), [0, 2], "a bow needs only the main hand");
  assertEquals(wearNew(p, 29).slot, 2);
  assertEquals([(equips[2] as Rec).index, (equips[3] as Rec).index], [29, 29], "a copy in the off hand, as the game saves it");
  assertEquals(carriedItems(p).filter((c) => c.index === 29).length, 1, "listed once");

  assertEquals(takeOff(p, 2, 29), 12, "into the backpack");
  assertEquals([equips[2], equips[3]], [E, E]);
  assertThrows(() => takeOff(p, 2, 29), /no longer worn/);
  const inPack = carriedItems(p).find((c) => c.index === 12)!.contents.find((c) => c.index === 29)!;
  assertEquals(inPack.place.path, [{ part: 0, x: 0, y: 0 }]);
  assertEquals([itemAt(p, inPack.place)!.X, itemAt(p, inPack.place)!.Y], [0, 0]);

  assertEquals(wearCarried(p, inPack.place, 29), 2);
  assertEquals(freeCells(p), 35, "the backpack is empty again");
  assertEquals((equips[3] as Rec).index, 29);
  assertThrows(() => wearCarried(p, inPack.place, 29), /no longer there/);
});

Deno.test("equipment: taking off needs room in another bag; a backpack never goes into itself", () => {
  const full = empty(4, 2).map((row, y) => row.map((_, x) => cell(72, 20, x, y)));
  const p = dressed({ 8: backpack(), 9: cell(13, 1, E, E, { subParts: [{ type: 0, parentIndex: 13, gridSave: full }] }) });
  assertThrows(() => takeOff(p, 8, 12), /no room/);
  assertEquals(takeOff(p, 9, 13), 12, "the full pouch goes into the backpack, coins and all");
  const pouch = carriedItems(p)[0].contents[0];
  assertEquals([pouch.index, pouch.contents.length], [13, 8]);
});

Deno.test("spawned creatures have a fresh grid; quest characters are protected", () => {
  const b = newBeing(17, 10, 20);
  assertEquals([b.index, b.x, b.y, b.status, b.state, b.homeX, b.localStage, b.turnLimit], [17, 168, 328, -200, 0, E, -1, E]);
  assertEquals(b.hpgrid, freshHealth(17));
  assertEquals((b.statusgrid as unknown[][]).length, (b.hpgrid as unknown[][]).length);
  assertEquals(parseBeings([b])[0].health?.w, freshHealth(17)![0].length, "the viewer reads it back");
  assert(!spawnable(12) && !spawnable(22) && !spawnable(9) && spawnable(3), "Bhato, Scaal and the Dead Unwanted are not spawnable");
  assert(isQuestBeing(12) && isQuestBeing(9) && !isQuestBeing(3) && !isQuestBeing(35));
  const list: unknown[] = [{ index: 3 }];
  spawnBeing(list, 2, 0, 0);
  assertEquals(list.length, 2);
  assertEquals((deleteBeing(list, 0) as Rec).index, 3);
  assertEquals(list.length, 1);
  assertThrows(() => deleteBeing(list, 5), /No creature/);
  // Removing by content: after the list changed, the same creature is found where it is now.
  const crowd: unknown[] = [{ index: 1 }, { index: 2 }, { index: 3 }];
  const third = JSON.stringify(crowd[2]);
  crowd.shift();
  assertEquals((deleteBeing(crowd, 2, third) as Rec).index, 3);
  assertEquals(crowd, [{ index: 2 }]);
  assertThrows(() => deleteBeing(crowd, 0, third), /no longer there/);
  assertThrows(() => newBeing(12, 0, 0), /cannot be spawned/);
});

Deno.test("ground: walls and pits block, water is water, shade is free, things take tiles", () => {
  const data = new Uint32Array(TILES * TILES), water = new Uint32Array(TILES * TILES);
  data[0] = 1, data[1] = 2, data[2] = 3, water[3] = 5;
  const g = groundMap(data, water, [tileBox(4 * 16 + 3, 9), [5 * 16, 0, 6 * 16 + 15, 15], [0, 0, 15, 15]]);
  assertEquals([...g.subarray(0, 8)], [
    Ground.Blocked,
    Ground.Free,
    Ground.Blocked,
    Ground.Water,
    Ground.Taken,
    Ground.Taken,
    Ground.Taken,
    0,
  ]);
});

Deno.test("the Cheated mark keeps its first time, counts edits and keeps other keys", () => {
  const shared = writeMarker(undefined, { fromShare: true });
  const once = markCheated(shared, new Date("2026-10-11T12:00:00Z"));
  const twice = markCheated(once, new Date("2027-01-01T00:00:00Z"));
  assertEquals(cheatedInfo(twice), { since: "2026-10-11T12:00:00.000Z", edits: 2 });
  assertEquals(readMarker(twice).fromShare, true);
  assertEquals(cheatedInfo(shared), undefined);
  assertEquals(cheatedInfo(undefined), undefined);
  assertEquals(cheatedInfo('{"cheated":true}'), { since: undefined, edits: undefined });
  assertEquals(cheatedInfo('{"cheated":{"since":"","edits":1.5,"note":"x"}}'), { since: undefined, edits: undefined });
  for (const text of ['{"cheated":false}', '{"cheated":"1"}', '{"cheated":null}', "[MirkMap]\r\ncheated=1\r\n"]) {
    assertEquals(cheatedInfo(text), undefined, text);
  }
  // A mark without details gets them on the next edit, keeping its other entries.
  assertEquals(readMarker(markCheated('{"cheated":{"note":"x"}}', new Date("2026-10-11T12:00:00Z"))).cheated, {
    note: "x",
    since: "2026-10-11T12:00:00.000Z",
    edits: 1,
  });
  assertEquals(cheatedInfo(ensureCheated(shared)), { since: undefined, edits: undefined });
  assertEquals(ensureCheated(twice), twice);
});

Deno.test("isCheated reads the character's MirkMap.json in any letter case", async () => {
  const files: FileMap = new Map([["Saves/Ann/mirkmap.JSON", {
    read: () => Promise.resolve(new TextEncoder().encode(markCheated(undefined))),
  }]]);
  assert(await isCheated(files, "Saves/Ann/"));
  assert(!(await isCheated(files, "Saves/Bob/")));
});

// --- Real saves, edited in memory only ---

const dir = Deno.env.get("MIRKLURK_SAVES") ??
  decodeURIComponent(new URL("../../Saves", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const characters: string[] = [];
try {
  for (const e of Deno.readDirSync(dir)) if (e.isDirectory) characters.push(e.name);
} catch {
  // No saves here.
}

Deno.test({ name: "real saves: every edit round-trips through the viewer's parsers", ignore: !characters.length }, () => {
  let edited = 0;
  for (const name of characters) {
    let bytes: Uint8Array;
    try {
      bytes = Deno.readFileSync(`${dir}/${name}/Player.save`);
    } catch {
      continue;
    }
    const raw = decodeJson(bytes);
    const p = playerRecord(raw);
    const before = parsePlayer(raw);
    const coinsBefore = before.inventory ? countCoins(before.inventory) : undefined;
    const r = addItems(p, 72, 7);
    setVitals(p, { wellbeing: 1, satiation: 1, focus: 1, stamina: 1, warmth: 0.5 });
    healPlayer(p);
    setLevel(p, Math.min(60, before.level + 1));
    setSky(p, { weather: Weather.Rain, rain: 0.5, minute: 600 });
    // Encoded as save_datajson does: JSON then one NUL byte.
    const text = JSON.stringify(raw);
    const out = new Uint8Array([...new TextEncoder().encode(text), 0]);
    const after = parsePlayer(decodeJson(out));
    assertEquals(after.level, Math.min(60, before.level + 1), name);
    assertEquals(after.vitals?.wellbeing, 1, name);
    assert(after.health!.cells.flat().every((c) => c.hp !== 0 && c.hp !== -1 && !c.poison), `${name}: healed`);
    if (coinsBefore && after.inventory) {
      assertEquals(countCoins(after.inventory).copper - coinsBefore.copper, r.added, `${name}: copper added`);
    }
    for (const bag of carriedBags(p)) {
      const parsed = parseInventoryGrid(bag.grid);
      assert(parsed.state === "saved", `${name}: bag readable`);
    }
    edited++;
  }
  assert(edited > 0);
});
