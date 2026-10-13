import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import {
  MAGUS_SHARD,
  PRICES,
  sells as sellsIn,
  sortWeight,
  STOCK,
  stockOf,
  Trader,
  waresIn,
  waresOf as waresOfIn,
  WHEN,
} from "../src/merchants.ts";
import type { GameVersion } from "../src/version.ts";
import { itemImage, itemWiki } from "../src/wiki.ts";
import { assert, assertEquals } from "./assert.ts";

const NEW: GameVersion = "0.8.9.9", OLD: GameVersion = "0.8.1.5";
const sells = (being: number) => sellsIn(being, NEW);
const waresOf = (being: number) => waresOfIn(being, NEW);
const WARES: Record<number, readonly number[]> = Object.fromEntries(Object.keys(STOCK).map((b) => [b, waresIn(Number(b), NEW)]));
const TRADERS = [8, 12, 19, 20, 26, 33, 34, 36];
/** Items 0.8.9.9 added: the wiki catalog bundled before the update has no pages or pictures for them yet. */
const FIRST_NEW_ITEM = 258;

Deno.test("merchants: exactly the eight traders sell, each with stock and a note on when they trade", () => {
  assertEquals(TRADERS.map((b) => BEING_NAMES[b]), [
    "Magus Clay",
    "Ranger Bhato",
    "Viend",
    "Commander Tain",
    "Gurb-Gurb",
    "Ihar",
    "Wilda",
    "Grand Mother",
  ]);
  assertEquals(Object.values(Trader).sort((a, b) => a - b), TRADERS);
  for (let being = -1; being < 64; being++) assertEquals(sells(being), TRADERS.includes(being), `being ${being}`);
  for (const being of TRADERS) {
    assert(WARES[being].length > 0 && WHEN[being], BEING_NAMES[being]);
    assertEquals([...WARES[being]].sort((a, b) => a - b), [...STOCK[being]].sort((a, b) => a - b), BEING_NAMES[being]);
  }
  assertEquals(waresOf(6), []);
});

Deno.test("merchants: every ware has a name and a positive price, and older ones a wiki page and an icon", () => {
  for (const index of new Set(Object.values(WARES).flat())) {
    const name = ITEM_NAMES[index];
    assert(name, `item ${index} has no name`);
    assert(PRICES[index] > 0, `${name} has no price`);
    assert(index >= FIRST_NEW_ITEM || (itemWiki(name) && itemImage(index)), `${name} lacks a verified wiki page or icon`);
  }
});

Deno.test("merchants: prices match gml_Object_databank_Alarm_1, shown as the game's coins", () => {
  assertEquals(
    [185, 45, 112, 252, 85, 58, 140].map((i) => [ITEM_NAMES[i], PRICES[i]]),
    [
      ["Steel Greatsword", 30],
      ["Iron Arrow", 0.06],
      ["Lamp Oil", 10],
      ["Map Ledger", 10],
      ["Sickness Remedy", 0.45],
      ["Steel Shield", 12.5],
      ["Minor Wound Salve", 0.25],
    ],
  );
  const shield = waresOf(Trader.Ihar).find((w) => w.index === 58)!;
  assertEquals(shield.coins, { gold: 1, silver: 2, copper: 50 });
  assertEquals(waresOf(Trader.Clay).find((w) => w.index === 85)!.coins, { gold: 0, silver: 0, copper: 45 });
});

Deno.test("merchants: wares are listed in inventory_sort's order, larger first, then cheaper", () => {
  // The 3×3 Storage Chest that 0.8.9.9 adds to Clay's and Viend's stock leads both lists.
  assertEquals(WARES[Trader.Clay], [275, 44, 57, 14, 27, 41, 45, 85, 86, 156, 114, 113, 115, 112, 140, 84, 32]);
  assertEquals(WARES[Trader.Bhato], [250, 105, 106, 249, 148, 153, 45, 46, 114, 113, 115, 144]);
  assertEquals(WARES[Trader.Viend], [275, 28, 41, 45, 85, 86, 156, 252, 114, 113, 115, 112, 139, 138, 140, 84, 32]);
  assertEquals(WARES[Trader.Tain], [252]);
  assertEquals(WARES[Trader.Gurb], [206, 179, 172, 248, 86, 251, 112, 139, 138]);
  assertEquals(WARES[Trader.Ihar], [189, 187, 185, 56, 58, 55, 54, 8, 10, 191]);
  assertEquals(WARES[Trader.Wilda], [212, 45, 174, 219, 85, 114, 113, 115, 144, 84, 32]);
  // Grand Mother's three 10-silver orbs tie and keep their stock order; the Shard (1×2) and Summoning Stone (1×1) come last.
  assertEquals(WARES[Trader.Mother], [273, 271, 269, 267, 272, 266, 274, 270, 268, 262, 127]);
  for (const being of TRADERS) {
    const w = WARES[being].map(sortWeight);
    assert(w.every((v, i) => i === 0 || w[i - 1] >= v), `${BEING_NAMES[being]} out of order`);
  }
  // Bow (2×3) before boots (2×2); among 2×2, the cheaper boots first; arrows pushed behind the 1×3 torch.
  assertEquals([44, 57, 14, 41, 45].map((i) => Math.round(sortWeight(i) * 100) / 100), [5997.8, 3997, 3996.5, 2969.8, 2549.94]);
});

Deno.test("merchants: the Storage Chest, Grand Mother's magic and her Magus' Shard from stage 30", () => {
  assertEquals([275, 262, 266, 268, 273].map((i) => PRICES[i]), [15, 50, 22.5, 32.5, 8]);
  assertEquals(waresOf(Trader.Clay)[0].coins, { gold: 1, silver: 5, copper: 0 });
  assertEquals(waresOf(Trader.Mother).find((w) => w.index === MAGUS_SHARD)?.note, "from main quest stage 30");
  assertEquals(waresOf(Trader.Mother).filter((w) => w.note).length, 1);
  assert(WHEN[Trader.Mother].includes("Wilda trusts you") && WHEN[Trader.Wilda].includes("Survivors' camp"));
});

Deno.test("merchants: 0.8.1.5's six traders, without the Storage Chest or Viend's Steel Hand Axe", () => {
  const old = TRADERS.filter((b) => sellsIn(b, OLD));
  assertEquals(old.map((b) => BEING_NAMES[b]), ["Magus Clay", "Ranger Bhato", "Viend", "Commander Tain", "Gurb-Gurb", "Ihar"]);
  for (let being = -1; being < 64; being++) assertEquals(sellsIn(being, OLD), old.includes(being), `being ${being}`);
  assertEquals([waresOfIn(Trader.Wilda, OLD), waresOfIn(Trader.Mother, OLD)], [[], []]);
  // menu_add in 0.8.1.5 (gml_GlobalScript_scr_menu_related): the same order, less what 0.8.9.9 added.
  assertEquals(stockOf(Trader.Clay, OLD), [140, 32, 84, 85, 86, 27, 45, 14, 57, 44, 41, 113, 115, 114, 112, 156]);
  assertEquals(stockOf(Trader.Viend, OLD), [140, 32, 138, 84, 139, 85, 86, 45, 41, 113, 115, 114, 112, 156, 252]);
  assertEquals(waresIn(Trader.Clay, OLD), [44, 57, 14, 27, 41, 45, 85, 86, 156, 114, 113, 115, 112, 140, 84, 32]);
  assertEquals(waresIn(Trader.Viend, OLD), [41, 45, 85, 86, 156, 252, 114, 113, 115, 112, 139, 138, 140, 84, 32]);
  for (const b of [Trader.Bhato, Trader.Tain, Trader.Gurb, Trader.Ihar]) assertEquals(stockOf(b, OLD), STOCK[b], BEING_NAMES[b]);
  // Nothing 0.8.1.5 sold is newer than it.
  for (const b of old) assert(stockOf(b, OLD).every((i) => i < 258), BEING_NAMES[b]);
});
