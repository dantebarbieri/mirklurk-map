// What the six traders sell and how trading works, ported from Mirklurk 0.8.1.5 (decompiled GML). References name the source entry.

import { type Coins, coinsView, priceCoins } from "./coins.ts";
import { h } from "./dom.ts";
import { ITEM_NAMES } from "./gamedata.ts";
import { picture, section, type SectionContext, wikiLink } from "./inspect.ts";
import { itemImage, itemWiki, wikiUrl } from "./wiki.ts";

/** The traders, by being index (`BEING_NAMES`). */
export const Trader = { Clay: 8, Bhato: 12, Viend: 19, Tain: 20, Gurb: 26, Ihar: 33 } as const;

/**
 * Each trader's stock in the order `menu_add` (gml_GlobalScript_scr_menu_related, menu type 8) adds it: one new item of each,
 * rebuilt every time the trade window opens.
 */
export const STOCK: Readonly<Record<number, readonly number[]>> = {
  [Trader.Clay]: [140, 32, 84, 85, 86, 27, 45, 14, 57, 44, 41, 113, 115, 114, 112, 156],
  [Trader.Bhato]: [113, 115, 114, 144, 105, 106, 45, 46, 148, 153, 250, 249],
  [Trader.Viend]: [140, 32, 138, 84, 139, 85, 86, 45, 41, 113, 115, 114, 112, 156, 252],
  [Trader.Tain]: [252],
  [Trader.Gurb]: [138, 139, 86, 112, 172, 179, 206, 248, 251],
  [Trader.Ihar]: [55, 54, 56, 8, 10, 58, 189, 191, 187, 185],
};

/**
 * Every ware's itemDB entry (gml_Object_databank_Alarm_1): price in silver, size in inventory cells (its sprite's size ÷ 16)
 * and item type. The databank's crafting-cost floor raises none of these prices.
 */
const WARE_DATA: Readonly<Record<number, readonly [price: number, w: number, h: number, type: number]>> = {
  8: [20, 1, 4, 16], // Steel Longsword
  10: [5, 1, 3, 16], // Steel Shortsword
  14: [3.5, 2, 2, 7], // Medium Backpack
  27: [2.5, 1, 3, 16], // Iron Hand Axe
  32: [0.6, 1, 1, 20], // Lesser Wound Salve
  41: [0.2, 1, 3, 23], // Torch
  44: [2.2, 2, 3, 17], // Shortbow (Willow)
  45: [0.06, 1, 3, 24], // Iron Arrow
  46: [0.12, 1, 3, 24], // Steel Arrow
  54: [10, 2, 2, 1], // Steel Bascinet
  55: [15, 2, 3, 4], // Steel Chestplate
  56: [12, 2, 3, 10], // Steel Legplates
  57: [3, 2, 2, 12], // Sturdy Leather Boots
  58: [12.5, 2, 3, 15], // Steel Shield
  84: [0.3, 1, 1, 20], // Minor Antidote
  85: [0.45, 1, 2, 13], // Sickness Remedy
  86: [2, 1, 2, 13], // Sickness Cure
  105: [6.5, 2, 4, 17], // Longbow (Cypress)
  106: [10, 2, 4, 17], // Longbow (Yew)
  112: [10, 1, 2, 27], // Lamp Oil
  113: [0.75, 2, 1, 27], // Cloth Repair Kit
  114: [0.45, 1, 2, 27], // Wood Repair Kit
  115: [1, 1, 2, 27], // Metal Repair Kit
  138: [1.5, 1, 2, 20], // Wound Salve
  139: [1, 1, 2, 20], // Antidote
  140: [0.25, 1, 1, 20], // Minor Wound Salve
  144: [0.25, 2, 1, 20], // Bandage
  148: [5.5, 2, 2, 7], // Ranger's Backpack
  153: [2.5, 3, 1, 22], // Decent Bedroll
  156: [5, 2, 1, 13], // Map Drawing Kit
  172: [20, 2, 3, 22], // Survivor's Field Kit
  179: [16.5, 2, 3, 17], // Gurb's Expertimental Bow
  185: [30, 2, 4, 17], // Steel Greatsword
  187: [30, 2, 4, 17], // Steel Warhammer
  189: [30, 2, 4, 17], // Steel Battleaxe
  191: [11.5, 1, 3, 16], // Steel Mace
  206: [20, 2, 4, 17], // Thorns of Wackah
  248: [1, 2, 2, 22], // Jar of Fireflies
  249: [5, 1, 5, 22], // Canopy (2x2 tiles)
  250: [15, 2, 5, 22], // Canopy (3x3 tiles)
  251: [3.5, 1, 2, 29], // Gurb's Flask of Vileness
  252: [10, 1, 2, 28], // Map Ledger
};

/** What each ware costs, in silver (1 gold = 10 silver = 1000 copper). */
export const PRICES: Readonly<Record<number, number>> = Object.fromEntries(
  Object.entries(WARE_DATA).map(([index, [price]]) => [index, price]),
);

/** How far inventory_sort (gml_GlobalScript_scr_basic_useful) pushes some item types back, by type. */
const TYPE_SHIFT: Readonly<Record<number, number>> = { 25: 500, 24: 450, 20: 400, 14: 300, 18: 200, 22: 100, 26: 50, 27: 40, 23: 30 };

/** inventory_sort's priority: larger first, then cheaper, with arrows, medicine, camp gear, repair kits and torches further back. */
export function sortWeight(index: number): number {
  const [price, w, h, type] = WARE_DATA[index];
  return w * h * 1000 - price - (TYPE_SHIFT[type] ?? 0);
}

/**
 * Stock as the trade window lists it after inventory_sort, highest priority first. Equal priorities (Ihar's three 30-silver
 * two-handers) keep the stock order here; the game breaks such ties by where they lay in the grid, which is not modelled.
 */
export const tradeOrder = (stock: readonly number[]) => [...stock].sort((a, b) => sortWeight(b) - sortWeight(a));

/** Each trader's wares in display order. Commander Tain's single ware skips the sort, as in menu_add. */
export const WARES: Readonly<Record<number, readonly number[]>> = Object.fromEntries(
  Object.entries(STOCK).map(([being, stock]) => [being, Number(being) === Trader.Tain ? stock : tradeOrder(stock)]),
);

/** Whether a being trades with the player. */
export const sells = (being: number): boolean => Object.hasOwn(WARES, being);

export interface Ware {
  index: number;
  name: string;
  /** In silver. */
  price: number;
  coins: Coins;
}

export const waresOf = (being: number): Ware[] =>
  (WARES[being] ?? []).map((index) => ({
    index,
    name: ITEM_NAMES[index] ?? `Item ${index}`,
    price: PRICES[index],
    coins: priceCoins(PRICES[index]),
  }));

/**
 * When each trader offers Trade in conversation (the NPC dialogue options in gml_Object_UI_Draw_64), with the gist of what
 * they say about it (Bestiary.ini).
 */
export const WHEN: Readonly<Record<number, string>> = {
  [Trader.Clay]: "Offers Trade in his everyday conversation once you have met him, though not while he has story to tell.",
  [Trader.Bhato]: "Offers Trade in his everyday conversation; if Captain Eir sent you, hear him out first.",
  [Trader.Viend]: "Only trades once Clay has fled the fort and Captain Eir has put Viend in charge of trading (main quest stage 27).",
  [Trader.Tain]: "Sells nothing but Map Ledgers and sends you to Clay for supplies. Not while he has story to tell.",
  [Trader.Gurb]: "Trades from your first meeting. His Survivor's Field Kit needs fuel you bring yourself.",
  [Trader.Ihar]: "Trades once he has introduced himself: arms and armour salvaged from the cargo ship he claimed.",
};

const wareRow = (ware: Ware) => {
  const url = itemWiki(ware.name);
  const icon = itemImage(ware.index);
  return h(
    "li",
    {},
    h(
      "span",
      { class: "ware-name" },
      icon ? picture(icon, "", "item-icon", 24, 20, true) : null,
      url ? wikiLink(url, ware.name) : ware.name,
    ),
    coinsView(ware.coins, { cls: "coins ware-price" }),
  );
};

/** Inspection sections for a merchant: its wares and their prices, then how trading works. */
export function merchantView(being: number, ctx: SectionContext): HTMLElement[] {
  const wares = waresOf(being);
  if (!wares.length) return [];
  return [
    section(
      ctx,
      "wares",
      "Wares (price each)",
      true,
      h("ul", { class: "wares", "aria-label": "Wares and their prices each" }, wares.map(wareRow)),
      WHEN[being] ? h("p", { class: "muted" }, WHEN[being]) : null,
    ),
    section(
      ctx,
      "trading",
      "How trading works",
      false,
      h(
        "ul",
        { class: "trade-rules" },
        h("li", {}, "Stock never runs out: each time you open the trade window it is refilled with new, full-condition wares."),
        h(
          "li",
          {},
          "You pay the listed prices, with no markup. They buy anything but quest items at the same list price, scaled by condition: ",
          "durability left (at least 10%), or fuel left for light sources (at least 25%).",
        ),
        h(
          "li",
          {},
          "Coins are goods too: mark them, or use Balance Trade with Coins to add whole stacks from your open bags. The trade goes ",
          "through once your goods cover the cost, and the difference comes back as gold, silver and copper.",
        ),
      ),
      h(
        "p",
        { class: "trade-guides" },
        wikiLink(wikiUrl("Merchants"), "Merchants"),
        " · ",
        wikiLink(wikiUrl("Currency and trading"), "Currency and trading"),
      ),
    ),
  ];
}
