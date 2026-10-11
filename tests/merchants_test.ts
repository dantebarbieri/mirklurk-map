import { BEING_NAMES, ITEM_NAMES } from "../src/gamedata.ts";
import { PRICES, sells, sortWeight, STOCK, Trader, WARES, waresOf, WHEN } from "../src/merchants.ts";
import { itemImage, itemWiki } from "../src/wiki.ts";
import { assert, assertEquals } from "./assert.ts";

const TRADERS = [8, 12, 19, 20, 26, 33];

Deno.test("merchants: exactly the six traders sell, each with stock and a note on when they trade", () => {
  assertEquals(TRADERS.map((b) => BEING_NAMES[b]), ["Magus Clay", "Ranger Bhato", "Viend", "Commander Tain", "Gurb-Gurb", "Ihar"]);
  assertEquals(Object.values(Trader).sort((a, b) => a - b), TRADERS);
  for (let being = -1; being < 64; being++) assertEquals(sells(being), TRADERS.includes(being), `being ${being}`);
  for (const being of TRADERS) {
    assert(WARES[being].length > 0 && WHEN[being], BEING_NAMES[being]);
    assertEquals([...WARES[being]].sort((a, b) => a - b), [...STOCK[being]].sort((a, b) => a - b), BEING_NAMES[being]);
  }
  assertEquals(waresOf(6), []);
});

Deno.test("merchants: every ware has a name, a positive price, a wiki page and an icon", () => {
  for (const index of new Set(Object.values(WARES).flat())) {
    const name = ITEM_NAMES[index];
    assert(name, `item ${index} has no name`);
    assert(PRICES[index] > 0, `${name} has no price`);
    assert(itemWiki(name) && itemImage(index), `${name} lacks a verified wiki page or icon`);
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
  assertEquals(WARES[Trader.Clay], [44, 57, 14, 27, 41, 45, 85, 86, 156, 114, 113, 115, 112, 140, 84, 32]);
  assertEquals(WARES[Trader.Bhato], [250, 105, 106, 249, 148, 153, 45, 46, 114, 113, 115, 144]);
  assertEquals(WARES[Trader.Viend], [41, 45, 85, 86, 156, 252, 114, 113, 115, 112, 139, 138, 140, 84, 32]);
  assertEquals(WARES[Trader.Tain], [252]);
  assertEquals(WARES[Trader.Gurb], [206, 179, 172, 248, 86, 251, 112, 139, 138]);
  assertEquals(WARES[Trader.Ihar], [189, 187, 185, 56, 58, 55, 54, 8, 10, 191]);
  for (const being of TRADERS) {
    const w = WARES[being].map(sortWeight);
    assert(w.every((v, i) => i === 0 || w[i - 1] >= v), `${BEING_NAMES[being]} out of order`);
  }
  // Bow (2×3) before boots (2×2); among 2×2, the cheaper boots first; arrows pushed behind the 1×3 torch.
  assertEquals([44, 57, 14, 41, 45].map((i) => Math.round(sortWeight(i) * 100) / 100), [5997.8, 3997, 3996.5, 2969.8, 2549.94]);
});
