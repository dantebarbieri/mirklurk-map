import { assert, assertEquals } from "./assert.ts";
import { cellArmor, cellKind, healthText, parseHealth, summarize } from "../src/health.ts";
import { coinValue, countCoins, fewestCoins, priceCoins } from "../src/coins.ts";
import { parseItemList } from "../src/inventory.ts";
import { parseBeings, parsePlayer } from "../src/save.ts";

Deno.test("health: hpgrid values and lasting statuses, [y][x] as saved", () => {
  // A Sceetler-like grid: corners are no hit point, the centre carries 3 armor.
  const g = parseHealth([[-4, 1, -4], [0, 4, -1], [-4, 1, -4]], [
    [[], [2, 2, 6.4], []],
    [[], [10, 11.5, 13, 13], []],
    [[], [23], []],
  ]);
  assert(g);
  assertEquals([g.w, g.h, g.stunned], [3, 3, true]);
  assertEquals(g.cells[1].map(cellKind), ["lost", "healthy", "burned"]);
  assertEquals(cellArmor(g.cells[1][1]), 3);
  assertEquals(g.cells[0][1].poison, 2);
  assertEquals(g.cells[1][1].bleed, [1, 1, 0, 2]);
  assertEquals(summarize(g), {
    total: 5,
    healthy: 3,
    lost: 1,
    burned: 1,
    armor: 3,
    poisonedCells: 1,
    poison: 2,
    bleedingCells: 1,
    bleed: 4,
  });
  assertEquals(
    healthText(g),
    "3 of 5 hit points left · 1 lost · 1 burned · 3 armor · poison ×2 in 1 cell · bleeding ×4 in 1 cell · stunned",
  );
});

Deno.test("health: malformed grids are absent; mismatched statuses are ignored", () => {
  assertEquals(parseHealth(undefined), undefined);
  assertEquals(parseHealth([[1, 1], [1]]), undefined);
  assertEquals(parseHealth([[1, "x"]]), undefined);
  const g = parseHealth([[1, 1]], [[[2]]]);
  assert(g);
  assertEquals(g.cells[0][0].poison, 0);
});

Deno.test("health: player vitals and beings' hit points are parsed from saves", () => {
  const p = parsePlayer([{
    worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]),
    hpgrid: [[1, 0], [-4, 1]],
    statusgrid: [[[], []], [[], []]],
    haelth: 0.42,
    focus: 0.1,
    energy: 0.03,
    hunger: 0.51,
    warmth: 0.2,
    aeList: [4, 16],
    level: 7,
    hpAddPoints: 1,
  }]);
  assertEquals(p.vitals, { wellbeing: 0.42, focus: 0.1, stamina: 0.03, satiation: 0.51, warmth: 0.2 });
  assertEquals(p.effects, [4, 16]);
  assertEquals([p.level, p.newHitPoints], [7, 1]);
  assertEquals(p.health && summarize(p.health).healthy, 2);
  assertEquals(parsePlayer([{ worldGrid: Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]) }]).vitals, undefined);
  const [b] = parseBeings([{ index: 30, x: 8, y: 8, state: 0, hpgrid: [[4, 4], [4, 4]], statusgrid: [[[], []], [[], []]] }]);
  assertEquals(b.health && summarize(b.health).armor, 12);
});

Deno.test("coins: nested roll-up, fewest coins and prices", () => {
  const coin = (index: number, amount: number) => ({ index, amount, X: 0, Y: 0, subParts: [] });
  const pouch = { ...coin(12, 1), subParts: [{ type: 0, gridSave: [[coin(72, 250)], [coin(73, 12)]] }] };
  const inv = parseItemList([coin(74, 1), pouch, coin(72, 5)]);
  const c = countCoins(inv);
  assertEquals(c, { gold: 1, silver: 12, copper: 255 });
  assertEquals(coinValue(c), 2455);
  assertEquals(fewestCoins(coinValue(c)), { gold: 2, silver: 4, copper: 55 });
  assertEquals(priceCoins(0.29), { gold: 0, silver: 0, copper: 29 });
  assertEquals(priceCoins(12.5), { gold: 1, silver: 2, copper: 50 });
  assertEquals(countCoins({ state: "unrolled", reason: "" }), { gold: 0, silver: 0, copper: 0 });
});
