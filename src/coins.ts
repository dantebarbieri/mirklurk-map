// Coins and prices (Mirklurk 0.8.1.5). Item prices are in silver: Copper Coin 0.01, Silver Coin 1, Gold Coin 10
// (gml_Object_databank_Alarm_1), and item_draw_cost in gml_GlobalScript_scr_items shows a price as gold, silver, copper.

import { h } from "./dom.ts";
import { ITEM_NAMES } from "./gamedata.ts";
import type { Inventory } from "./inventory.ts";
import { itemImage } from "./wiki.ts";

export const Coin = { Copper: 72, Silver: 73, Gold: 74 } as const;

export interface Coins {
  gold: number;
  silver: number;
  copper: number;
}

/** What a coin is worth in copper. */
export const COPPER_VALUE: Record<number, number> = { [Coin.Copper]: 1, [Coin.Silver]: 100, [Coin.Gold]: 1000 };

/** Every coin in a saved inventory, counting nested bags and pouches; unsaved inventories count as none. */
export function countCoins(inv: Inventory | undefined): Coins {
  const out: Coins = { gold: 0, silver: 0, copper: 0 };
  const walk = (i: Inventory | undefined) => {
    if (i?.state !== "saved") return;
    for (const item of i.items) {
      if (item.index === Coin.Gold) out.gold += item.amount;
      else if (item.index === Coin.Silver) out.silver += item.amount;
      else if (item.index === Coin.Copper) out.copper += item.amount;
      item.contents.forEach(walk);
    }
  };
  walk(inv);
  return out;
}

export const coinValue = (c: Coins) => c.copper + c.silver * 100 + c.gold * 1000;

/** The fewest coins worth `copper`: 100 copper make a silver, 10 silver a gold. */
export function fewestCoins(copper: number): Coins {
  const v = Math.max(0, Math.round(copper));
  return { gold: Math.floor(v / 1000), silver: Math.floor((v % 1000) / 100), copper: v % 100 };
}

/** A price in silver, as the game's coins (to the nearest copper). */
export const priceCoins = (silver: number) => fewestCoins(silver * 100);

const COIN_ORDER: [keyof Coins, number][] = [["gold", Coin.Gold], ["silver", Coin.Silver], ["copper", Coin.Copper]];

/**
 * Coins as amounts beside their icons ("1 [gold] 3 [silver] 25 [copper]"). Zero amounts are left out unless `all`;
 * nothing at all reads "0 [copper]" so the line is never empty.
 */
export function coinsView(c: Coins, { all = false, cls = "coins" }: { all?: boolean; cls?: string } = {}): HTMLElement {
  const shown = COIN_ORDER.filter(([k]) => all || c[k] > 0);
  const parts = shown.length ? shown : COIN_ORDER.slice(2);
  return h(
    "span",
    { class: cls, title: parts.map(([k, idx]) => `${c[k]} × ${ITEM_NAMES[idx]}`).join(", ") },
    parts.map(([k, idx]) => {
      const img = itemImage(idx);
      return h(
        "span",
        { class: `coin ${k}` },
        String(c[k]),
        img
          ? h("img", { class: "coin-icon", src: img.file, width: 16, height: 16, alt: ITEM_NAMES[idx], decoding: "async" })
          : h("span", { class: "coin-tag" }, k[0]),
      );
    }),
  );
}
